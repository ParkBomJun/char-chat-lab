import pricingFile from "@/config/pricing.json";
import type { Usage } from "@/lib/llm/types";

/** cacheWritePer1M: 캐시 쓰기 단가(선택, 없으면 0). 캐시를 만드는 요청에만 쓰기 토큰이 붙는다(실측). */
export type ModelPrice = { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number; cacheWritePer1M?: number };
export type PricingTable = { default: ModelPrice; models: Record<string, ModelPrice> };

export const pricing: PricingTable = pricingFile;

/**
 * 추정 비용(USD). 제공사의 입력 토큰 수는 캐시된 토큰을 포함한다.
 * OpenRouter + Gemini 실측(2026-11-11~12, docs/CACHE.md):
 *  - 캐시를 처음 만드는 요청: cached = cache_write이고 그 토큰에 읽기 단가와 쓰기 단가가 둘 다 청구된다.
 *  - 유지 시간 안에 같은 앞부분이 다시 온 요청: cached > 0, cache_write = 0이고 읽기 단가만 청구된다.
 * 식: (입력 − max(캐시읽기, 캐시쓰기)) × 입력 단가 + 캐시읽기 × 읽기 단가 + 캐시쓰기 × 쓰기 단가(없으면 0) + 출력 × 출력 단가.
 * 두 경우 모두 실제 청구액과 일치한다(테스트로 고정). 쓰기 토큰이 읽기 토큰과 겹친다고 보는 가정이다(겹치지 않는 제공사에는 맞지 않을 수 있다).
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
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens);
  const cacheTokens = Math.max(cached, written);
  const cost =
    ((usage.inputTokens - cacheTokens) * p.inputPer1M +
      cached * p.cachedInputPer1M +
      written * (p.cacheWritePer1M ?? 0) +
      usage.outputTokens * p.outputPer1M) /
    1_000_000;
  return { cost, priced: price !== undefined };
}
