import type { Usage } from "@/lib/llm/types";
import type { BlockTokens } from "@/lib/chat/assemble";
import type { CacheBreak, PrefixHashes } from "@/lib/chat/prefix-diag";
import { estimateCost, type PricingTable, pricing } from "@/lib/pricing";
import { estimateTokens } from "@/lib/tokens";

/** 조립 결과의 디버깅용 부가 정보 */
export type PromptMeta = {
  lorebookIds: string[];
  /** 고정 블록에 상시 포함된 로어북 항목 id(없으면 생략) */
  inlineLorebookIds?: string[];
  droppedRecent: number;
  /** 블록별 해시(원문 없음)와, 직전 턴 대비 캐시 접두사가 처음 달라진 블록 */
  prefix?: PrefixHashes;
  cacheBreak?: CacheBreak;
};

export type UsageRowInput = {
  model: string;
  /** 제공사가 준 usage. 없으면(중간 중지 등) 글자 수로 추정한다. */
  usage: Usage | null;
  /** 채팅 호출만 있다(요약·분류기는 null) */
  blockTokens: BlockTokens | null;
  /** 채팅 호출의 조립 메타(로어북 id 등). blockTokens와 같은 JSON에 합쳐 저장 */
  promptMeta?: PromptMeta;
  /** usage가 없을 때 입력 토큰 추정값 */
  estimatedInputTokens: number;
  outputText: string;
  ttftMs: number | null;
  totalMs: number;
};

export type UsageRowData = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  /** 캐시 쓰기 토큰. 제공사 usage가 없으면 null(알 수 없음), 있으면 보고된 값(없으면 0) */
  cacheWriteTokens: number | null;
  outputTokens: number;
  usageEstimated: boolean;
  /** Prisma Decimal에 문자열로 넘긴다(부동소수 오차 방지) */
  estCost: string;
  /** 제공사가 준 실제 청구액(없으면 null). 있으면 비용 표시는 이 값을 우선한다. estCost는 비교용으로 유지 */
  actualCost: string | null;
  ttftMs: number | null;
  totalMs: number;
  blockTokens: (BlockTokens & Partial<PromptMeta>) | null;
};

export function buildUsageRow(i: UsageRowInput, table: PricingTable = pricing): UsageRowData {
  const usage: Usage = i.usage ?? {
    inputTokens: i.estimatedInputTokens,
    cachedInputTokens: 0,
    outputTokens: estimateTokens(i.outputText),
  };
  const { cost } = estimateCost(i.model, usage, table);
  return {
    model: i.model,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: i.usage === null ? null : (i.usage.cacheWriteTokens ?? 0),
    outputTokens: usage.outputTokens,
    usageEstimated: i.usage === null,
    estCost: cost.toFixed(8),
    actualCost: i.usage?.cost !== undefined ? i.usage.cost.toFixed(8) : null,
    ttftMs: i.ttftMs,
    totalMs: i.totalMs,
    blockTokens: i.blockTokens ? { ...i.blockTokens, ...i.promptMeta } : null,
  };
}
