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
};
