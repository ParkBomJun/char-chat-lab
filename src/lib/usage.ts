import type { Usage } from "@/lib/llm/types";
import type { BlockTokens } from "@/lib/chat/assemble";
import { estimateCost, type PricingTable, pricing } from "@/lib/pricing";
import { estimateTokens } from "@/lib/tokens";

export type UsageRowInput = {
  model: string;
  /** 제공사가 준 usage. 없으면(중간 중지 등) 글자 수로 추정한다. */
  usage: Usage | null;
  /** 채팅 호출만 있다(요약·분류기는 null) */
  blockTokens: BlockTokens | null;
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
  outputTokens: number;
  usageEstimated: boolean;
  /** Prisma Decimal에 문자열로 넘긴다(부동소수 오차 방지) */
  estCost: string;
  ttftMs: number | null;
  totalMs: number;
  blockTokens: BlockTokens | null;
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
    outputTokens: usage.outputTokens,
    usageEstimated: i.usage === null,
    estCost: cost.toFixed(8),
    ttftMs: i.ttftMs,
    totalMs: i.totalMs,
    blockTokens: i.blockTokens,
  };
}
