/** 추론(reasoning) 강도 값. 클라이언트 번들에 어댑터 코드가 딸려 가지 않도록 작은 모듈로 분리했다. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
