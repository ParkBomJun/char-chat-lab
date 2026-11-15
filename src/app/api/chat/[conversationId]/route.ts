import { NextRequest, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { resolveRuntime } from "@/lib/llm/runtime";
import { LlmError, type StreamMeta, type Usage } from "@/lib/llm/types";
import { explainEmptyResponse } from "@/lib/llm-settings";
import { assemblePrompt } from "@/lib/chat/assemble";
import { diagnoseCacheBreak, readPrefixHashes } from "@/lib/chat/prefix-diag";
import { buildUsageRow } from "@/lib/usage";
import { formatSse } from "@/lib/sse";
import { updateSummaryForConversation } from "@/lib/memory/db";
import { planLorebook } from "@/lib/lorebook/plan";
import { checkInput } from "@/lib/safety/input";
import { StreamGuard, checkOutputFinal, streamEvent } from "@/lib/safety/output";
import { NOTICE, dailyLimitNotice } from "@/lib/safety/messages";
import { applyFlow, logClassifierCalls, saveEvents, saveNotice } from "@/lib/safety/persist";
import { countTodayMessages } from "@/lib/daily-limit";
import { saveResponseMetric } from "@/lib/quality/persist";
import { remainingMessages } from "@/lib/kst";

export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 2000;
const bodySchema = z.object({ content: z.string().trim().min(1).max(MAX_INPUT_CHARS) });

const json = (status: number, error: string) => Response.json({ error }, { status });

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // 프록시 버퍼링 방지
};

/** 이미 정해진 이벤트 목록을 한 번에 내려보내고 닫는 SSE 응답 (입력 단계에서 거절된 경우). */
function sseOnce(events: [string, unknown][], headers: Record<string, string>) {
  return new Response(events.map(([e, p]) => formatSse(e, p)).join(""), { headers: { ...SSE_HEADERS, ...headers } });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/chat/[conversationId]">) {
  const session = await auth();
  if (!session?.user) return json(401, "로그인이 필요합니다.");
  const userId = session.user.id;

  const { conversationId } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, `메시지는 1~${MAX_INPUT_CHARS}자여야 합니다.`);
  const userInput = parsed.data.content;

  // 소유권 확인: 남의 대화는 존재 자체를 숨긴다(404).
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    // 조립기가 쓰는 필드만 읽는다. 캐릭터 전체(include)를 읽으면 이후 코드가 응답에 객체를 그대로 실을 때 비공개 필드가 새기 쉽다.
    select: { status: true, characterId: true, character: { select: { name: true, persona: true, speechStyle: true, exampleDialog: true } } },
  });
  if (!conv) return json(404, "대화를 찾을 수 없습니다.");
  if (conv.status === "STOPPED") return json(409, "중단된 대화입니다.");

  const config = loadConfig();

  // ── [일일 사용량 확인] 초과면 거절. 분류기·모델을 부르기 전에 막는다 ───────────
  const used = await countTodayMessages(userId);
  const remainingHeader = (counted: boolean) => ({
    "X-Daily-Remaining": String(remainingMessages(config.dailyMessageLimit, used + (counted ? 1 : 0))),
  });
  if (used >= config.dailyMessageLimit) {
    return Response.json(
      { error: dailyLimitNotice(config.dailyMessageLimit) },
      { status: 429, headers: remainingHeader(false) },
    );
  }

  const rt = await resolveRuntime(); // 관리자 화면 설정 > 환경변수 > mock
  const classifier = rt.classifier;
  const threshold = config.classifierBlockThreshold;

  // ── [입력 안전 검사] 차단이면 모델을 부르지 않는다 ──────────────────────────
  const input = await checkInput(userInput, { classifier, threshold });

  if (input.outcome === "error") {
    // fail closed: 검사하지 못한 입력은 모델에 보내지 않는다. 대화에는 아무것도 남기지 않는다(재시도 가능).
    await saveEvents(conversationId, null, input.events);
    return Response.json({ error: NOTICE.checkFailed }, { status: 503, headers: remainingHeader(false) }); // 메시지가 저장되지 않으므로 한도에 세지 않는다
  }

  if (input.outcome !== "allow") {
    const crisis = input.outcome === "crisis";
    // 위기 표현은 사용자의 말이라 그대로 남기고, 정책 위반 입력은 회수 처리해 이후 프롬프트·요약에 들어가지 않게 한다.
    const userMsg = await prisma.message.create({
      data: { conversationId, role: "USER", content: userInput, retracted: !crisis },
      select: { id: true },
    });
    await saveEvents(conversationId, userMsg.id, input.events);
    await logClassifierCalls(userId, conversationId, input.calls, rt.pricing);
    const text = crisis ? NOTICE.crisis : NOTICE.inputBlocked;
    const noticeId = await saveNotice(conversationId, text);
    const flow = await applyFlow(conversationId, input.turnScore, config.flow);
    const events: [string, unknown][] = [[crisis ? "crisis" : "blocked", { text, noticeId }]];
    if (flow.notice) events.push(["notice", flow.notice]);
    return sseOnce(events, remainingHeader(true));
  }

  // ── 프롬프트 조립 ───────────────────────────────────────────────────────────
  // 최근 대화 = 최신 요약이 덮지 않은 메시지 전부(회수된 메시지는 제외). 요약 갱신 사이에는 시작점이 고정돼
  // 프롬프트 앞부분이 변하지 않으므로 제공사 캐시가 이어진다. (SPEC 3-3)
  const summary = await prisma.memorySummary.findFirst({
    where: { conversationId },
    orderBy: { version: "desc" },
    select: { content: true, coversUntilMsg: true },
  });
  const cover = summary
    ? await prisma.message.findUnique({ where: { id: summary.coversUntilMsg }, select: { createdAt: true } })
    : null;
  const recent = (
    await prisma.message.findMany({
      where: { conversationId, retracted: false, ...(cover ? { createdAt: { gt: cover.createdAt } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200, // 요약이 계속 실패해도 조회량이 무한히 커지지 않게 하는 안전 상한(실제 길이는 토큰 예산이 정한다)
      select: { role: true, content: true },
    })
  ).reverse();

  const userMsg = await prisma.message.create({
    data: { conversationId, role: "USER", content: userInput },
    select: { id: true },
  });
  await saveEvents(conversationId, userMsg.id, input.events);
  await logClassifierCalls(userId, conversationId, input.calls, rt.pricing);

  // 로어북: 전체가 작으면 고정 블록에 상시 포함, 크면 최근 M턴(이번 입력 포함)에서 키워드가 나온 활성 항목만. (SPEC 3-4)
  const entries = await prisma.lorebookEntry.findMany({
    where: { characterId: conv.characterId, enabled: true },
    select: { id: true, keywords: true, content: true, priority: true, enabled: true },
  });
  const lorePlan = planLorebook(entries, [...recent, { role: "USER", content: userInput }], { scanTurns: config.lorebookScanTurns, inlineMaxTokens: config.lorebookInlineMaxTokens });
  const lorebookHits = lorePlan.hits;

  const assembled = assemblePrompt(conv.character, summary?.content ?? null, lorebookHits, recent, userInput, {
    promptTokenBudget: config.promptTokenBudget,
    lorebookTokenBudget: config.lorebookTokenBudget,
    lorebookPosition: config.cache.lorebookPosition,
    fixedLorebook: lorePlan.inline,
    cacheBreakpoint: config.cache.breakpoint,
    cacheMinTokens: config.cache.minTokens,
    cacheBreakpointPosition: config.cache.breakpointPosition,
    cacheStepTokens: config.cache.stepTokens,
  });

  const { adapter, chatModel } = rt.llm;

  // 응답을 다 보낸 뒤 실행된다(응답 속도 보호). 서버리스에서도 끊기지 않도록 after() 사용.
  after(async () => {
    try {
      const r = await updateSummaryForConversation(conversationId, userId);
      if (r.updated) console.log(`[memory] 요약 v${r.version} 갱신 (${r.summarizedMessages}개 메시지)`);
    } catch (e) {
      console.error("[memory] 요약 갱신 실패(다음 턴에 재시도)", e);
    }
  });

  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(formatSse(event, payload)));
        } catch {
          /* 클라이언트가 이미 끊김 */
        }
      };

      // 업스트림을 우리가 끊을 수 있도록(규칙 차단 시 비용 절약) 별도 컨트롤러를 둔다.
      const upstream = new AbortController();
      const onAbort = () => upstream.abort();
      req.signal.addEventListener("abort", onAbort);

      const guard = new StreamGuard();
      let usage: Usage | null = null;
      let streamMeta: StreamMeta | null = null;
      let ttftMs: number | null = null;
      let failed = false;
      let streamBlockedCategory: string | null = null;

      try {
        for await (const ev of adapter.stream({
          model: chatModel,
          messages: assembled.messages,
          maxOutputTokens: rt.maxOutputTokens,
          signal: upstream.signal,
        })) {
          if (ev.type === "delta") {
            if (ttftMs === null) ttftMs = Date.now() - startedAt;
            const check = guard.feed(ev.text);
            if (check.blocked) {
              streamBlockedCategory = check.category;
              upstream.abort();
              break; // 이 청크는 보내지 않는다. 이미 보낸 앞부분은 아래에서 회수한다.
            }
            send("delta", { text: ev.text });
          } else {
            usage = ev.usage;
            streamMeta = ev.meta ?? null;
          }
        }
      } catch (e) {
        if (!req.signal.aborted && !streamBlockedCategory) {
          failed = true;
          console.error("[chat] LLM 오류", e instanceof LlmError ? e.message : e);
          send("error", { message: "응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요." });
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort);
      }

      const text = guard.text;
      let outputScore = 0;
      let outputCheckFailed = false; // 출력 분류기 장애(ERROR)

      if (!failed && text.length > 0) {
        // ── [출력 안전 검사] 스트리밍 중 규칙 차단 또는 완료 후 분류기 ─────────────
        let retractNotice: string | null = null;
        let events = [] as ReturnType<typeof streamEvent>[];
        let calls = [] as Awaited<ReturnType<typeof checkOutputFinal>>["calls"];

        if (streamBlockedCategory) {
          retractNotice = NOTICE.outputRetracted;
          events = [streamEvent(true, streamBlockedCategory)];
          outputScore = 1;
        } else {
          const out = await checkOutputFinal(text, userInput, { classifier, threshold });
          events = [streamEvent(false), ...out.events];
          calls = out.calls;
          outputScore = out.turnScore;
          if (out.outcome === "blocked") retractNotice = NOTICE.outputRetracted;
          if (out.outcome === "error") {
            retractNotice = NOTICE.checkFailed;
            outputCheckFailed = true;
          }
        }

        // 저장은 판정 뒤에: 회수 대상은 처음부터 retracted=true로 저장해 어떤 경로로도 이후 프롬프트에 들어가지 않는다.
        const saved = await prisma.message.create({
          data: { conversationId, role: "ASSISTANT", content: text, retracted: retractNotice !== null },
          select: { id: true },
        });
        await saveEvents(conversationId, saved.id, events);
        await logClassifierCalls(userId, conversationId, calls, rt.pricing);
        // 응답 품질 지표(기록만, 차단·재생성에 쓰지 않는다). 회수된 응답은 제외하고, 실패해도 대화는 계속된다.
        if (!retractNotice) {
          try {
            await saveResponseMetric({ messageId: saved.id, conversationId, characterId: conv.characterId, content: text });
          } catch (e) {
            console.error("[quality] 응답 지표 기록 실패", e);
          }
        }

        if (retractNotice) {
          const noticeId = await saveNotice(conversationId, retractNotice);
          send("retract", { text: retractNotice, noticeId });
        } else {
          send("done", { messageId: saved.id });
        }

        // 사용량 기록은 응답 표시 뒤에. 회수된 응답도 비용은 발생했으니 기록한다.
        try {
          // 캐시 접두사 진단: 이 대화의 직전 대화 호출과 블록 해시를 비교해 어디서 깨졌는지 남긴다.
          const prevChat = await prisma.usageLog.findFirst({
            where: { conversationId, kind: "CHAT" },
            orderBy: { createdAt: "desc" },
            select: { blockTokens: true },
          });
          const cacheBreak = diagnoseCacheBreak(readPrefixHashes(prevChat?.blockTokens), assembled.prefix);
          const row = buildUsageRow({
            model: chatModel,
            usage,
            blockTokens: assembled.blockTokens,
            promptMeta: { lorebookIds: assembled.lorebookIds, ...(assembled.inlineLorebookIds.length ? { inlineLorebookIds: assembled.inlineLorebookIds } : {}), droppedRecent: assembled.droppedRecent, overBudget: assembled.overBudget, prefix: assembled.prefix, cacheBreak },
            estimatedInputTokens: assembled.blockTokens.total,
            outputText: text,
            ttftMs,
            totalMs: Date.now() - startedAt,
          }, rt.pricing);
          await prisma.usageLog.create({
            data: { userId, conversationId, kind: "CHAT", ...row, blockTokens: row.blockTokens ?? Prisma.DbNull },
          });
        } catch (e) {
          console.error("[chat] UsageLog 기록 실패", e);
        }
      } else if (!failed) {
        // 원인(추론 모델의 토큰 소진 등)은 서버 로그에 남기고, 사용자에게는 일반 문구를 보인다
        console.error("[chat] " + explainEmptyResponse(streamMeta, usage, rt.maxOutputTokens), `(model=${chatModel})`);
        send("error", { message: "빈 응답이 왔어요. 다시 시도해 주세요." });
      }

      // ── [대화 흐름 감시] 입력·출력 중 높은 점수를 이번 턴 점수로 ───────────────
      // 출력 분류기 장애(ERROR) 턴은 점수를 알 수 없으므로 평균에서 뺀다(0점으로 넣으면 평균이 내려가 감시가 약해진다).
      try {
        const flow = outputCheckFailed ? null : await applyFlow(conversationId, Math.max(input.turnScore, outputScore), config.flow);
        if (flow?.notice) send("notice", flow.notice);
      } catch (e) {
        console.error("[safety] 흐름 감시 실패", e);
      }

      try {
        controller.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, ...remainingHeader(true) } });
}
