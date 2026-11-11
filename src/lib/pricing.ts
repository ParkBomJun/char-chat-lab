import pricingFile from "@/config/pricing.json";
import type { Usage } from "@/lib/llm/types";

/** cacheWritePer1M: 캐시 쓰기 단가(선택). 없으면 쓰기 토큰도 입력 단가로 계산한다. */
export type ModelPrice = { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number; cacheWritePer1M?: number };
export type PricingTable = { default: ModelPrice; models: Record<string, ModelPrice> };

export const pricing: PricingTable = pricingFile;

/**
 * 추정 비용(USD). 제공사의 입력 토큰 수는 캐시된 토큰을 포함하므로
 * (입력 - 캐시읽기 - 캐시쓰기) × 입력 단가 + 캐시읽기 × 캐시 읽기 단가 + 캐시쓰기 × 캐시 쓰기 단가(없으면 입력 단가) + 출력 × 출력 단가.
 * 캐시 쓰기 토큰도 입력 토큰에 포함돼 있다고 가정한다(OpenRouter의 prompt_tokens_details.cache_write_tokens).
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
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached);
  const cost =
    ((usage.inputTokens - cached - written) * p.inputPer1M +
      cached * p.cachedInputPer1M +
      written * (p.cacheWritePer1M ?? p.inputPer1M) +
      usage.outputTokens * p.outputPer1M) /
    1_000_000;
  return { cost, priced: price !== undefined };
}
