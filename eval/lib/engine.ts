/**
 * 평가용 대화 엔진. src/app/api/chat/[conversationId]/route.ts의 파이프라인을 DB 없이 메모리에서 재현한다.
 * 같은 순수 함수(조립기·로어북 매칭·요약 계획·안전 검사·흐름 감시)와 같은 어댑터를 그대로 쓰므로
 * 토큰·캐시·지연·차단 동작은 서비스와 같은 코드 경로로 나온다. 다만 아래 둘은 서비스와 다르다:
 *  - DB 왕복 시간이 지연 측정에 들어가지 않는다(LLM 호출 구간만 잰다).
 *  - 라우트의 오케스트레이션(이 파일의 runTurn)은 라우트를 손으로 옮긴 것이라, 라우트를 바꾸면 여기도 맞춰야 한다.
 */
import { assemblePrompt, type CharacterCard } from "@/lib/chat/assemble";
import { collectText } from "@/lib/llm/collect";
import type { LlmAdapter } from "@/lib/llm/types";
import { matchLorebook, type LorebookEntryData } from "@/lib/lorebook/match";
import { SUMMARY_MAX_OUTPUT_TOKENS } from "@/lib/memory/prompt";
import { runSummaryUpdate } from "@/lib/memory/update";
import { estimateTokens } from "@/lib/tokens";
import { buildUsageRow } from "@/lib/usage";
import { pricing } from "@/lib/pricing";
import type { Classifier, ClassifyCall } from "@/lib/safety/classifier";
import { evaluateFlow, type FlowConfig, type FlowStatus } from "@/lib/safety/flow";
import { checkInput } from "@/lib/safety/input";
import { StreamGuard, checkOutputFinal, streamEvent } from "@/lib/safety/output";
import { PROVIDER_FILTER_PATTERN } from "@/lib/safety/failure";
import type { ModEvent } from "@/lib/safety/types";
import { looksLikeRefusal } from "./metrics";
import type { CallRecord, Intervention, InterventionKind, InterventionStage, TurnResult } from "./types";

export type SimMessage = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; content: string; retracted: boolean };

export type EngineConfig = {
  recentTurns: number;
  summaryEvery: number;
  /** false면 요약 없이 전체 대화를 원문으로 보낸다(비교 기준선) */
  summaryEnabled: boolean;
  promptTokenBudget: number;
  lorebookTokenBudget: number;
  lorebookScanTurns: number;
  maxOutputTokens: number;
  classifierThreshold: number;
  flow: FlowConfig;
  /** false면 입력 검사까지만(모델 호출 없음). 안전 규칙·분류기만 빠르게 시험할 때 */
  generate: boolean;
  /**
   * false면 앱의 안전 층(입력 규칙·입력 분류기·스트리밍 규칙·출력 분류기·흐름 감시)을 모두 끄고 모델만 부른다(--no-app-safety).
   * 남는 것: 고정 블록의 안전 지시문·카드 원칙, 제공사/모델 자체 필터. 기본 true(서비스와 같음).
   */
  appSafety?: boolean;
};

/** 제공사/모델의 하드 필터를 알리는 오류 문구(OpenRouter 모더레이션 403, 콘텐츠 정책 등). 모델이 말로 하는 거절은 해당하지 않는다. */
export { PROVIDER_FILTER_PATTERN };

export type EngineDeps = { adapter: LlmAdapter; chatModel: string; lightModel: string; classifier: Classifier };

export class SimConversation {
  messages: SimMessage[] = [];
  summaries: { content: string; version: number; coversUntilMsg: string }[] = [];
  status: FlowStatus = "ACTIVE";
  strikes = 0;
  /** 마지막 경고/위반 이후의 턴별 점수(서비스의 persist.applyFlow와 같은 윈도우 규칙) */
  flowScores: number[] = [];
  private seq = 0;

  constructor(
    readonly character: CharacterCard & { greeting: string },
    readonly lorebook: LorebookEntryData[],
  ) {
    this.add("ASSISTANT", character.greeting, false);
  }

  nextId() {
    return `m${++this.seq}`;
  }
  add(role: SimMessage["role"], content: string, retracted: boolean): SimMessage {
    const m = { id: this.nextId(), role, content, retracted };
    this.messages.push(m);
    return m;
  }
  get latestSummary() {
    return this.summaries.at(-1) ?? null;
  }
}

const now = () => performance.now();

function toRecord(kind: CallRecord["kind"], row: ReturnType<typeof buildUsageRow>, model: string): CallRecord {
  return {
    kind,
    model,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    usageEstimated: row.usageEstimated,
    cost: Number(row.actualCost ?? row.estCost),
    ttftMs: row.ttftMs,
    totalMs: row.totalMs,
    unpriced: pricing.models[model] === undefined,
  };
}

function classifierRecord(c: ClassifyCall, stage: "INPUT" | "OUTPUT"): CallRecord {
  const row = buildUsageRow({
    model: c.model,
    usage: c.usage,
    blockTokens: null,
    estimatedInputTokens: c.promptTokens,
    outputText: c.outputText,
    ttftMs: null,
    totalMs: c.totalMs,
  });
  return { ...toRecord("CLASSIFIER", row, c.model), stage, retryCount: c.retryCount ?? 0, retryExtraMs: c.retryExtraMs ?? 0 };
}

/** 분류기가 실제 판정을 낸 이벤트의 점수(ERROR·규칙 층 제외) */
export function classifierScoresOf(events: readonly ModEvent[]): number[] {
  return events.filter((e) => e.layer === "CLASSIFIER" && e.verdict !== "ERROR" && typeof e.score === "number").map((e) => e.score as number);
}

/** ModEvent → 개입 기록. 통과(action=none)는 기록하지 않는다. */
export function interventionsFromEvents(events: readonly ModEvent[]): Intervention[] {
  const out: Intervention[] = [];
  for (const e of events) {
    if (e.action === "none") continue;
    const stage: InterventionStage =
      e.stage === "INPUT" ? (e.layer === "RULE" ? "INPUT_RULE" : "INPUT_CLASSIFIER") : e.stage === "OUTPUT_STREAM" ? "OUTPUT_STREAM" : e.stage === "OUTPUT_FINAL" ? "OUTPUT_FINAL" : "FLOW";
    const kind: InterventionKind =
      e.verdict === "ERROR" ? "check_failed" : e.action === "crisis_notice" ? "crisis" : (e.action as InterventionKind);
    const src = e.decisionSource ? { decisionSource: e.decisionSource } : {};
    out.push(e.verdict === "ERROR" ? { stage, kind, category: e.category, errorKind: e.errorKind ?? null, httpStatus: e.httpStatus ?? null, finishReason: e.finishReason ?? null } : { stage, kind, category: e.category, ...src });
  }
  return out;
}

function applyFlow(conv: SimConversation, turnScore: number, cfg: FlowConfig): Intervention | null {
  conv.flowScores.push(turnScore);
  const r = evaluateFlow(conv.flowScores, { status: conv.status, strikes: conv.strikes }, cfg);
  conv.status = r.status;
  conv.strikes = r.strikes;
  if (r.action === "none") return null;
  conv.flowScores = []; // 경고/위반 후 윈도우를 비운다
  return { stage: "FLOW", kind: r.action, category: "flow" };
}

const emptyTurn = (index: number): TurnResult => ({
  index,
  skipped: false,
  interventions: [],
  calls: [],
  inputCheckMs: 0,
  ttftMs: null,
  totalMs: null,
  outputCheckMs: 0,
  reply: null,
  llmError: false,
  blockTokens: null,
  summaryUpdated: false,
});

/** 한 턴을 서비스와 같은 순서로 처리한다. */
export async function runTurn(conv: SimConversation, index: number, userInput: string, deps: EngineDeps, cfg: EngineConfig): Promise<TurnResult> {
  const result = emptyTurn(index);
  if (conv.status === "STOPPED") return { ...result, skipped: true }; // 서비스는 409

  // ── [입력 안전 검사] ──
  const appSafety = cfg.appSafety !== false;
  const t0 = now();
  const input = appSafety
    ? await checkInput(userInput, { classifier: deps.classifier, threshold: cfg.classifierThreshold })
    : { outcome: "allow" as const, events: [] as ModEvent[], calls: [] as ClassifyCall[], turnScore: 0 };
  result.inputCheckMs = now() - t0;
  result.calls.push(...input.calls.map((c) => classifierRecord(c, "INPUT")));
  result.interventions.push(...interventionsFromEvents(input.events));
  result.classifierScores = classifierScoresOf(input.events);

  if (input.outcome === "error") return result; // 서비스: 503, 대화에 아무것도 남기지 않음, 흐름 감시 없음

  if (input.outcome !== "allow") {
    conv.add("USER", userInput, input.outcome === "blocked");
    conv.add("SYSTEM_NOTICE", "(안내)", false);
    const f = applyFlow(conv, input.turnScore, cfg.flow);
    if (f) result.interventions.push(f);
    return result;
  }

  // ── 프롬프트 조립 ──
  const summary = cfg.summaryEnabled ? conv.latestSummary : null;
  let recent = conv.messages.filter((m) => !m.retracted);
  if (summary) {
    const at = conv.messages.findIndex((m) => m.id === summary.coversUntilMsg);
    recent = conv.messages.slice(at + 1).filter((m) => !m.retracted);
  }
  const hits = matchLorebook(conv.lorebook, [...recent, { role: "USER", content: userInput }], cfg.lorebookScanTurns);
  const assembled = assemblePrompt(conv.character, summary?.content ?? null, hits, recent, userInput, {
    promptTokenBudget: cfg.promptTokenBudget,
    lorebookTokenBudget: cfg.lorebookTokenBudget,
  });
  result.blockTokens = assembled.blockTokens;
  conv.add("USER", userInput, false);

  if (!cfg.generate) {
    const f = appSafety ? applyFlow(conv, input.turnScore, cfg.flow) : null;
    if (f) result.interventions.push(f);
    return result;
  }

  // ── 스트리밍 + 규칙 가드 ──
  const upstream = new AbortController();
  const guard = new StreamGuard();
  let usage = null as Awaited<ReturnType<typeof collectText>>["usage"];
  let blockedCategory: string | null = null;
  let providerFiltered = false;
  const start = now();
  try {
    for await (const ev of deps.adapter.stream({
      model: deps.chatModel,
      messages: assembled.messages,
      maxOutputTokens: cfg.maxOutputTokens,
      signal: upstream.signal,
    })) {
      if (ev.type === "delta") {
        if (result.ttftMs === null) result.ttftMs = now() - start;
        const check = guard.feed(ev.text);
        if (appSafety && check.blocked) {
          blockedCategory = check.category;
          upstream.abort();
          break;
        }
      } else {
        usage = ev.usage;
        if (ev.meta?.finishReason === "content_filter") providerFiltered = true;
      }
    }
  } catch (e) {
    if (!blockedCategory) {
      if (e instanceof Error && PROVIDER_FILTER_PATTERN.test(e.message)) {
        providerFiltered = true; // 제공사 필터가 막은 것이지 서비스 장애가 아니다
      } else {
        result.llmError = true;
        console.error("  [eval] LLM 오류:", e instanceof Error ? e.message : e);
      }
    }
  }
  if (providerFiltered) result.interventions.push({ stage: "PROVIDER", kind: "provider_filtered", category: null });
  result.totalMs = now() - start;
  const text = guard.text;

  let outputScore = 0;
  let outputCheckFailed = false; // 출력 분류기 장애(ERROR) 턴은 흐름 감시 평균에서 뺀다(서비스와 동일)
  if (!result.llmError && text.length > 0) {
    let events: ModEvent[];
    let retracted = false;
    if (!appSafety) {
      events = [];
    } else if (blockedCategory) {
      events = [streamEvent(true, blockedCategory)];
      outputScore = 1;
      retracted = true;
    } else {
      const t1 = now();
      const out = await checkOutputFinal(text, userInput, { classifier: deps.classifier, threshold: cfg.classifierThreshold });
      result.outputCheckMs = now() - t1;
      events = [streamEvent(false), ...out.events];
      outputScore = out.turnScore;
      result.calls.push(...out.calls.map((c) => classifierRecord(c, "OUTPUT")));
      retracted = out.outcome !== "allow";
      outputCheckFailed = out.outcome === "error";
    }
    result.interventions.push(...interventionsFromEvents(events));
    result.classifierScores = [...(result.classifierScores ?? []), ...classifierScoresOf(events)];
    conv.add("ASSISTANT", text, retracted);
    result.reply = retracted ? null : text;
    result.rawReply = text;
    result.refusalLike = looksLikeRefusal(text);

    const row = buildUsageRow({
      model: deps.chatModel,
      usage,
      blockTokens: assembled.blockTokens,
      estimatedInputTokens: assembled.blockTokens.total,
      outputText: text,
      ttftMs: result.ttftMs,
      totalMs: result.totalMs,
    });
    result.calls.push(toRecord("CHAT", row, deps.chatModel));
  }

  const flow = appSafety && !outputCheckFailed ? applyFlow(conv, Math.max(input.turnScore, outputScore), cfg.flow) : null;
  if (flow) result.interventions.push(flow);

  // ── 요약 갱신: 서비스에서는 응답 후 비동기. 여기서는 다음 턴 전에 끝나도록 기다린다. ──
  if (cfg.summaryEnabled) result.summaryUpdated = await updateSummary(conv, deps, cfg, result);
  return result;
}

async function updateSummary(conv: SimConversation, deps: EngineDeps, cfg: EngineConfig, result: TurnResult): Promise<boolean> {
  let promptTokens = 0;
  const outcome = await runSummaryUpdate(
    {
      async load() {
        const prev = conv.latestSummary;
        let messages = conv.messages.filter((m) => !m.retracted);
        if (prev) messages = messages.slice(messages.findIndex((m) => m.id === prev.coversUntilMsg) + 1);
        return { characterName: conv.character.name, previous: prev, messages };
      },
      async summarize(messages) {
        promptTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
        const t = now();
        const { text, usage } = await collectText(deps.adapter, {
          model: deps.lightModel,
          messages,
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        });
        return { text, usage, totalMs: now() - t };
      },
      async logUsage({ usage, outputText, totalMs }) {
        const row = buildUsageRow({
          model: deps.lightModel,
          usage,
          blockTokens: null,
          estimatedInputTokens: promptTokens,
          outputText,
          ttftMs: null,
          totalMs,
        });
        result.calls.push(toRecord("SUMMARY", row, deps.lightModel));
      },
      async save(row) {
        conv.summaries.push(row);
        return true;
      },
    },
    { recentTurns: cfg.recentTurns, summaryEvery: cfg.summaryEvery },
  );
  return outcome.updated;
}

/** 대화 전체 실행. 중단된 뒤의 턴은 건너뛴 것으로 기록한다. */
export async function runConversation(
  character: CharacterCard & { greeting: string },
  lorebook: LorebookEntryData[],
  turns: readonly string[],
  deps: EngineDeps,
  cfg: EngineConfig,
  onTurn?: (r: TurnResult) => void,
): Promise<{ conv: SimConversation; results: TurnResult[] }> {
  const conv = new SimConversation(character, lorebook);
  const results: TurnResult[] = [];
  for (let i = 0; i < turns.length; i++) {
    const r = await runTurn(conv, i, turns[i], deps, cfg);
    results.push(r);
    onTurn?.(r);
  }
  return { conv, results };
}
