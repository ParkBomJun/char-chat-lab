import pricingFile from "@/config/pricing.json";
import type { Usage } from "@/lib/llm/types";

export type ModelPrice = { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number };
export type PricingTable = { default: ModelPrice; models: Record<string, ModelPrice> };

export const pricing: PricingTable = pricingFile;

/**
 * 추정 비용(USD). 제공사의 입력 토큰 수는 캐시된 토큰을 포함하므로
 * (입력 - 캐시) × 입력 단가 + 캐시 × 캐시 단가 + 출력 × 출력 단가.
 * 표에 없는 모델은 default 단가를 쓰고 priced=false로 알린다.
 */
export function estimateCost(
  model: string,
  usage: Usage,
  table: PricingTable = pricing,
): { cost: number; priced: boolean } {
  const price = table.models[model];
  const p = price ?? table.default;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cost =
    ((usage.inputTokens - cached) * p.inputPer1M + cached * p.cachedInputPer1M + usage.outputTokens * p.outputPer1M) /
    1_000_000;
  return { cost, priced: price !== undefined };
}
