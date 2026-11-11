import type { Usage } from "@/lib/llm/types";
import type { BlockTokens } from "@/lib/chat/assemble";

export type CallKind = "CHAT" | "SUMMARY" | "CLASSIFIER";

/** LLM 호출 1건의 측정값. 비용은 pricing.json 단가로 계산한 추정치. */
export type CallRecord = {
  kind: CallKind;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** true면 제공사 usage가 없어 글자 수로 추정한 값 */
  usageEstimated: boolean;
  cost: number;
  ttftMs: number | null;
  totalMs: number;
  /** 단가표에 없는 모델이라 default(보통 0) 단가로 계산됨 */
  unpriced: boolean;
};

export type InterventionStage = "INPUT_RULE" | "INPUT_CLASSIFIER" | "OUTPUT_STREAM" | "OUTPUT_FINAL" | "FLOW";
export type InterventionKind = "blocked" | "crisis" | "retracted" | "check_failed" | "warned" | "strike" | "stopped";

/** 안전 파이프라인이 개입한 기록(차단·회수·위기 안내·경고·중단). 통과는 기록하지 않는다. */
export type Intervention = { stage: InterventionStage; kind: InterventionKind; category: string | null };

export type TurnResult = {
  /** 0부터 */
  index: number;
  /** 대화가 이미 중단되어 건너뛴 턴 */
  skipped: boolean;
  interventions: Intervention[];
  calls: CallRecord[];
  /** 입력 안전 검사에 걸린 시간 */
  inputCheckMs: number;
  /** 응답 첫 토큰까지(입력 검사 제외). 모델을 부르지 않았으면 null */
  ttftMs: number | null;
  totalMs: number | null;
  /** 생성 완료 후 출력 분류기 시간 */
  outputCheckMs: number;
  reply: string | null;
  llmError: boolean;
  blockTokens: BlockTokens | null;
  summaryUpdated: boolean;
};

export type { Usage };
