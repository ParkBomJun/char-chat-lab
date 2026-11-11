import { checkRules, type CompiledRule, defaultRules } from "./rules";
import { isBlocked, type Classifier, type ClassifyCall } from "./classifier";
import type { ModEvent } from "./types";

/**
 * allow   : 모델 호출 진행
 * blocked : 정책 위반 → 안내만, 모델 호출 안 함
 * crisis  : 위기 표현 → 롤플레이 중단, 도움 안내, 모델 호출 안 함
 * error   : 검사 불가(분류기 실패) → fail closed, 모델 호출 안 함
 */
export type InputOutcome = "allow" | "blocked" | "crisis" | "error";

export type InputDecision = {
  outcome: InputOutcome;
  /** DB에 남길 판정들(통과 점수 포함) */
  events: ModEvent[];
  /** 흐름 감시용 이번 턴 입력 점수(0~1). 위기·검사 불가는 사용자에게 불이익이 없도록 0 */
  turnScore: number;
  /** 비용 기록용 분류기 호출 */
  calls: ClassifyCall[];
};

export type InputDeps = { classifier: Classifier; threshold: number; rules?: readonly CompiledRule[] };

const ev = (e: Omit<ModEvent, "stage">): ModEvent => ({ stage: "INPUT", ...e });

/** 입력 검사 (SPEC 3-5-1): 규칙 층 → 분류기 층. 차단·위기면 분류기는 부르지 않는다(비용 절약). */
export async function checkInput(text: string, deps: InputDeps): Promise<InputDecision> {
  const rule = checkRules(text, "input", deps.rules ?? defaultRules);

  if (rule.kind === "crisis") {
    return {
      outcome: "crisis",
      events: [ev({ layer: "RULE", verdict: "BLOCK", category: rule.category, score: null, action: "crisis_notice" })],
      turnScore: 0,
      calls: [],
    };
  }
  if (rule.kind === "block") {
    return {
      outcome: "blocked",
      events: [ev({ layer: "RULE", verdict: "BLOCK", category: rule.category, score: 1, action: "blocked" })],
      turnScore: 1,
      calls: [],
    };
  }

  const ruleEvent = ev({ layer: "RULE", verdict: "ALLOW", category: null, score: null, action: "none" });

  let call: ClassifyCall;
  try {
    call = await deps.classifier.classify({ stage: "INPUT", text });
  } catch (e) {
    console.error("[safety] 입력 분류기 실패 → 차단(fail closed):", e instanceof Error ? e.message : e);
    return {
      outcome: "error",
      events: [ruleEvent, ev({ layer: "CLASSIFIER", verdict: "ERROR", category: null, score: null, action: "blocked" })],
      turnScore: 0,
      calls: [],
    };
  }

  const v = call.verdict;
  if (isBlocked(v, deps.threshold)) {
    const crisis = v.category === "self_harm";
    return {
      outcome: crisis ? "crisis" : "blocked",
      events: [
        ruleEvent,
        ev({ layer: "CLASSIFIER", verdict: "BLOCK", category: v.category, score: v.score, action: crisis ? "crisis_notice" : "blocked" }),
      ],
      turnScore: crisis ? 0 : Math.max(v.score, deps.threshold),
      calls: [call],
    };
  }
  return {
    outcome: "allow",
    events: [ruleEvent, ev({ layer: "CLASSIFIER", verdict: "ALLOW", category: v.category, score: v.score, action: "none" })],
    turnScore: v.score,
    calls: [call],
  };
}
