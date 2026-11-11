import { NextRequest, after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { LlmError, type Usage } from "@/lib/llm/types";
import { assemblePrompt } from "@/lib/chat/assemble";
import { buildUsageRow } from "@/lib/usage";
import { formatSse } from "@/lib/sse";
import { updateSummaryForConversation } from "@/lib/memory/db";

export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 2000;
const bodySchema = z.object({ content: z.string().trim().min(1).max(MAX_INPUT_CHARS) });

const json = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: NextRequest, ctx: RouteContext<"/api/chat/[conversationId]">) {
  const session = await auth();
  if (!session?.user) return json(401, "로그인이 필요합니다.");

  const { conversationId } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, `메시지는 1~${MAX_INPUT_CHARS}자여야 합니다.`);
  const userInput = parsed.data.content;

  // 소유권 확인: 남의 대화는 존재 자체를 숨긴다(404).
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    include: { character: true },
  });
  if (!conv) return json(404, "대화를 찾을 수 없습니다.");
  if (conv.status === "STOPPED") return json(409, "중단된 대화입니다.");

  const config = loadConfig();

  // 이번 입력을 저장하기 전에 기존 대화를 읽는다(조립기에는 "이번 입력"을 따로 넘긴다).
  // 최근 대화 = 최신 요약이 덮지 않은 메시지 전부. 요약 갱신 사이에는 시작점이 고정돼
  // 프롬프트 앞부분이 변하지 않으므로 제공사 캐시가 이어진다. (SPEC 3-3)
  const summary = await prisma.memorySummary.findFirst({
    where: { conversationId: conv.id },
    orderBy: { version: "desc" },
    select: { content: true, coversUntilMsg: true },
  });
  const cover = summary
    ? await prisma.message.findUnique({ where: { id: summary.coversUntilMsg }, select: { createdAt: true } })
    : null;
  const recent = (
    await prisma.message.findMany({
      where: { conversationId: conv.id, retracted: false, ...(cover ? { createdAt: { gt: cover.createdAt } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200, // 요약이 계속 실패해도 조회량이 무한히 커지지 않게 하는 안전 상한(실제 길이는 토큰 예산이 정한다)
      select: { role: true, content: true },
    })
  ).reverse();

  await prisma.message.create({ data: { conversationId: conv.id, role: "USER", content: userInput } });

  // 5단계에서 로어북이 여기로 들어온다.
  const assembled = assemblePrompt(conv.character, summary?.content ?? null, [], recent, userInput, {
    promptTokenBudget: config.promptTokenBudget,
    lorebookTokenBudget: config.lorebookTokenBudget,
  });

  const { adapter, chatModel } = getLlm();

  // 응답을 다 보낸 뒤 실행된다(응답 속도 보호). 서버리스에서도 끊기지 않도록 after() 사용.
  after(async () => {
    try {
      const r = await updateSummaryForConversation(conv.id, session.user.id);
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

      let text = "";
      let usage: Usage | null = null;
      let ttftMs: number | null = null;
      let failed = false;
      try {
        for await (const ev of adapter.stream({
          model: chatModel,
          messages: assembled.messages,
          maxOutputTokens: config.maxOutputTokens,
          signal: req.signal,
        })) {
          if (ev.type === "delta") {
            if (ttftMs === null) ttftMs = Date.now() - startedAt;
            text += ev.text;
            send("delta", { text: ev.text });
          } else {
            usage = ev.usage;
          }
        }
      } catch (e) {
        if (!req.signal.aborted) {
          failed = true;
          console.error("[chat] LLM 오류", e instanceof LlmError ? e.message : e);
          send("error", { message: "응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요." });
        }
      }

      // 정상 종료, 또는 사용자가 중간에 멈춘 경우(받은 만큼 저장)
      if (!failed && text.length > 0) {
        const saved = await prisma.message.create({
          data: { conversationId: conv.id, role: "ASSISTANT", content: text },
          select: { id: true },
        });
        send("done", { messageId: saved.id });

        // 사용량 기록은 응답 표시 뒤에. 기록 실패가 대화를 깨면 안 된다.
        try {
          const row = buildUsageRow({
            model: chatModel,
            usage,
            blockTokens: assembled.blockTokens,
            estimatedInputTokens: assembled.blockTokens.total,
            outputText: text,
            ttftMs,
            totalMs: Date.now() - startedAt,
          });
          await prisma.usageLog.create({
            data: { userId: session.user.id, conversationId: conv.id, kind: "CHAT", ...row, blockTokens: row.blockTokens ?? Prisma.DbNull },
          });
        } catch (e) {
          console.error("[chat] UsageLog 기록 실패", e);
        }
      } else if (!failed) {
        send("error", { message: "빈 응답이 왔어요. 다시 시도해 주세요." });
      }
      try {
        controller.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 프록시 버퍼링 방지
    },
  });
}
