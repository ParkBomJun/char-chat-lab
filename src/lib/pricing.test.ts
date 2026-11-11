import { describe, expect, it } from "vitest";
import { estimateCost, type PricingTable } from "./pricing";
import { loadConfig } from "./config";

const table: PricingTable = {
  default: { inputPer1M: 1, cachedInputPer1M: 0.5, outputPer1M: 2 },
  models: { m: { inputPer1M: 10, cachedInputPer1M: 1, outputPer1M: 30 } },
};

describe("estimateCost", () => {
  it("캐시 토큰은 입력에서 빼고 캐시 단가로 계산", () => {
    // (1000-400)*10 + 400*1 + 100*30 = 6000+400+3000 = 9400 → /1e6
    const r = estimateCost("m", { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 100 }, table);
    expect(r.cost).toBeCloseTo(0.0094, 10);
    expect(r.priced).toBe(true);
  });
  it("캐시 쓰기 토큰은 쓰기 단가로, 단가가 없으면 입력 단가로 계산", () => {
    const t: PricingTable = { default: table.default, models: { w: { inputPer1M: 10, cachedInputPer1M: 1, cacheWritePer1M: 5, outputPer1M: 30 }, n: table.models.m } };
    // (1000-400-200)*10 + 400*1 + 200*5 + 100*30 = 4000+400+1000+3000 = 8400
    expect(estimateCost("w", { inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 200, outputTokens: 100 }, t).cost).toBeCloseTo(0.0084, 10);
    // 쓰기 단가 없음: 200*10으로 → 9400과 같다
    expect(estimateCost("n", { inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 200, outputTokens: 100 }, t).cost).toBeCloseTo(0.0094, 10);
  });
  it("표에 없는 모델은 default, priced=false", () => {
    const r = estimateCost("unknown", { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 }, table);
    expect(r).toEqual({ cost: 1, priced: false });
  });
  it("캐시 토큰이 입력보다 크게 보고돼도 음수가 되지 않는다", () => {
    const r = estimateCost("m", { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 }, table);
    expect(r.cost).toBeGreaterThanOrEqual(0);
  });
});

describe("loadConfig", () => {
  it("기본값(SPEC 3장)", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ recentTurns: 20, summaryEvery: 10, lorebookScanTurns: 4, dailyMessageLimit: 50 });
  });
  it("빈 문자열은 기본값, 숫자 문자열은 파싱", () => {
    expect(loadConfig({ RECENT_TURNS: "", SUMMARY_EVERY: "5" })).toMatchObject({ recentTurns: 20, summaryEvery: 5 });
  });
  it("잘못된 값은 오류", () => {
    expect(() => loadConfig({ RECENT_TURNS: "abc" })).toThrow();
    expect(() => loadConfig({ RECENT_TURNS: "0" })).toThrow();
  });
});
