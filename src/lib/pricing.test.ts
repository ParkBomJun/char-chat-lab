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
  it("캐시 토큰에는 읽기+쓰기 단가가 모두 청구된다(실측 검산식)", () => {
    // 2026-11-11 실측 단가(USD/1M): 입력 0.75, 읽기 0.075, 쓰기 0.041667, 출력 3.75. cached = cacheWr = 6297, 총 입력 7000, 출력 100
    const t: PricingTable = { default: table.default, models: { g: { inputPer1M: 0.75, cachedInputPer1M: 0.075, cacheWritePer1M: 0.041667, outputPer1M: 3.75 } } };
    const r = estimateCost("g", { inputTokens: 7000, cachedInputTokens: 6297, cacheWriteTokens: 6297, outputTokens: 100 }, t);
    // 비캐시 703×0.75 + 6297×(0.075+0.041667) + 100×3.75 = 527.25 + 734.6... + 375 (÷1e6)
    expect(r.cost).toBeCloseTo((703 * 0.75 + 6297 * (0.075 + 0.041667) + 100 * 3.75) / 1e6, 12);
  });
  it("쓰기 단가가 없으면 쓰기 항목은 0(기존 계산과 동일)", () => {
    expect(estimateCost("m", { inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 400, outputTokens: 100 }, table).cost).toBeCloseTo(0.0094, 10);
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

describe("캐시 옵션 설정", () => {
  it("기본값: breakpoint 켬(E6 실측 후 결정), 로어북은 고정 블록 뒤", () => {
    expect(loadConfig({}).cache).toEqual({ breakpoint: true, minTokens: 4096, lorebookPosition: "afterFixed" });
  });
  it("환경변수로 켠다. 잘못된 값은 오류", () => {
    expect(loadConfig({ CACHE_BREAKPOINT: "0", LOREBOOK_POSITION: "beforeInput", CACHE_MIN_TOKENS: "5000" }).cache).toEqual({ breakpoint: false, minTokens: 5000, lorebookPosition: "beforeInput" });
    expect(() => loadConfig({ LOREBOOK_POSITION: "middle" })).toThrow();
  });
});
