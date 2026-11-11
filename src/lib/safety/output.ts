import { checkRules, evaluateRules, hintCategory, type CompiledRule, defaultRules } from "./rules";
import { softEvents } from "./input";
import { decisionSourceOf, failureOf, retryOf, isBlocked, type Classifier, type ClassifyCall } from "./classifier";
import type { ModEvent } from "./types";

export type StreamCheck = { blocked: false } | { blocked: true; category: string };

/**
 * 스트리밍 중 출력 검사 (SPEC 3-5-2, 규칙 층만). 청크마다 호출한다.
 * 청크 경계에서 단어가 쪼개져도 잡도록, 청크 하나가 아니라 지금까지 받은 전체 텍스트에 규칙을 적용한다.
 * (응답은 최대 수천 자라 매 청크 재검사 비용은 무시할 수준이다.)
 * 차단되면 그 청크는 클라이언트로 보내지 않는다. 앞서 보낸 부분은 호출 측이 회수한다.
 */
export class StreamGuard {
  private buffer = "";
  constructor(private readonly rules: readonly CompiledRule[] = defaultRules) {}

  feed(delta: string): StreamCheck {
    this.buffer += delta;
    const r = checkRules(this.buffer, "output", this.rules);
    return r.kind === "none" ? { blocked: false } : { blocked: true, category: r.category };
  }

  get text(): string {
    return this.buffer;
  }
}

export type OutputOutcome = "allow" | "blocked" | "error";
export type OutputDecision = {
  outcome: OutputOutcome;
  events: ModEvent[];
  /** 흐름 감시용 이번 턴 출력 점수 */
  turnScore: number;
  calls: ClassifyCall[];
};

export type OutputDeps = { classifier: Classifier; threshold: number; rules?: readonly CompiledRule[] };

const ev = (e: Omit<ModEvent, "stage">): ModEvent => ({ stage: "OUTPUT_FINAL", ...e });

/**
 * 생성 완료 후 출력 검사 (분류기 층). 차단이면 호출 측이 이미 보낸 메시지를 회수한다.
 * 분류기 실패는 통과가 아니라 차단(fail closed): 검사하지 못한 응답은 보여 주지 않는다.
 * 출력의 SOFT 규칙 적중은 스트리밍을 끊지 않고 여기서 기록해 분류기에 힌트로 넘긴다(점수·회수 여부는 분류기 판정으로만 정해진다).
 */
export async function checkOutputFinal(text: string, userInput: string, deps: OutputDeps): Promise<OutputDecision> {
  const softHits = evaluateRules(text, "output", deps.rules ?? defaultRules).soft;
  const soft = softEvents("OUTPUT_STREAM", softHits);
  const hints = softHits.map(hintCategory);
  let call: ClassifyCall;
  try {
    call = await deps.classifier.classify({ stage: "OUTPUT_FINAL", text, context: userInput, ...(hints.length ? { hints } : {}) });
  } catch (e) {
    console.error("[safety] 출력 분류기 실패 → 회수(fail closed):", e instanceof Error ? e.message : e);
    return {
      outcome: "error",
      events: [...soft, ev({ layer: "CLASSIFIER", verdict: "ERROR", category: null, score: null, action: "retracted", ...failureOf(e) })],
      turnScore: 0,
      calls: [],
    };
  }
  const v = call.verdict;
  if (isBlocked(v, deps.threshold)) {
    return {
      outcome: "blocked",
      events: [...soft, ev({ layer: "CLASSIFIER", verdict: "BLOCK", category: v.category, score: v.score, decisionSource: decisionSourceOf(v, deps.threshold), action: "retracted", ...retryOf(call) })],
      turnScore: Math.max(v.score, deps.threshold),
      calls: [call],
    };
  }
  return {
    outcome: "allow",
    events: [...soft, ev({ layer: "CLASSIFIER", verdict: "ALLOW", category: v.category, score: v.score, action: "none", ...retryOf(call) })],
    turnScore: v.score,
    calls: [call],
  };
}

/** 스트리밍 중 규칙 층 판정 기록. 통과는 응답 끝에 1건만 남긴다(청크마다 쌓지 않는다). */
export function streamEvent(blocked: boolean, category?: string): ModEvent {
  return blocked
    ? { stage: "OUTPUT_STREAM", layer: "RULE", verdict: "BLOCK", category: category ?? null, score: 1, action: "retracted" }
    : { stage: "OUTPUT_STREAM", layer: "RULE", verdict: "ALLOW", category: null, score: null, action: "none" };
}
