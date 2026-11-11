import type { ErrorKind } from "./failure";

export type ModDecisionSource = "VERDICT_ONLY" | "SCORE_ONLY" | "BOTH";

/** Prisma enum과 값이 같은 문자열 유니온(스키마의 ModStage/ModLayer/Verdict). */
export type ModStage = "INPUT" | "OUTPUT_STREAM" | "OUTPUT_FINAL" | "CONVERSATION";
export type ModLayer = "RULE" | "CLASSIFIER";
export type ModVerdict = "ALLOW" | "BLOCK" | "ERROR";
/** SPEC 4장 action 목록 + 흐름 감시의 반복 위반 "strike" */
export type ModAction = "none" | "blocked" | "retracted" | "warned" | "strike" | "stopped" | "crisis_notice";

/** DB에 남길 판정 1건. 사용자 원문은 저장하지 않는다(분석은 카테고리·점수로). */
export type ModEvent = {
  stage: ModStage;
  layer: ModLayer;
  verdict: ModVerdict;
  category: string | null;
  score: number | null;
  action: ModAction;
  /** 분류기가 차단(verdict=BLOCK)했을 때만: 차단 근거가 모델 verdict인지 점수 임계값인지 */
  decisionSource?: ModDecisionSource | null;
  /** verdict=ERROR일 때만: 원인(원문 없음). 그 밖에는 생략 */
  errorKind?: ErrorKind | null;
  httpStatus?: number | null;
  finishReason?: string | null;
  /** errorKind=parse_error일 때만: 응답의 모양(원문 아님) */
  responseLength?: number;
  startsWithBrace?: boolean;
  hasCodeFence?: boolean;
  hasRefusalPattern?: boolean;
  /** 분류기 호출을 재시도한 횟수(재시도가 있었던 이벤트에만). 성공·ERROR 모두 */
  retryCount?: number;
  /** 재시도로 늘어난 지연(ms) */
  retryExtraMs?: number | null;
};
