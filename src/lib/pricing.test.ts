import { describe, expect, it } from "vitest";
import { estimateCost, pricing, type PricingTable } from "./pricing";
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
  it("캐시를 만드는 요청은 그 토큰에 읽기+쓰기 단가가 모두 청구된다(실측 검산식)", () => {
    // 2026-11-11 실측 단가(USD/1M): 입력 0.75, 읽기 0.075, 쓰기 0.041667, 출력 3.75. cached = cacheWr = 6297, 총 입력 7000, 출력 100
    const t: PricingTable = { default: table.default, models: { g: { inputPer1M: 0.75, cachedInputPer1M: 0.075, cacheWritePer1M: 0.041667, outputPer1M: 3.75 } } };
    const r = estimateCost("g", { inputTokens: 7000, cachedInputTokens: 6297, cacheWriteTokens: 6297, outputTokens: 100 }, t);
    // 비캐시 703×0.75 + 6297×(0.075+0.041667) + 100×3.75 = 527.25 + 734.6... + 375 (÷1e6)
    expect(r.cost).toBeCloseTo((703 * 0.75 + 6297 * (0.075 + 0.041667) + 100 * 3.75) / 1e6, 12);
  });
  it("단가표의 google/gemini-3.8-flash가 실측 입력 청구액을 재현한다(2026-11-11, docs/CACHE.md)", () => {
    const m = "google/gemini-3.8-flash";
    // E4: 5,799토큰, 캐시 없음 → 입력 $0.00434925
    expect(estimateCost(m, { inputTokens: 5799, cachedInputTokens: 0, outputTokens: 0 }, pricing).cost).toBeCloseTo(0.00434925, 8);
    // E5b: 같은 길이, cached = cacheWr = 5647 → 입력 $0.00077282
    expect(estimateCost(m, { inputTokens: 5799, cachedInputTokens: 5647, cacheWriteTokens: 5647, outputTokens: 0 }, pricing).cost).toBeCloseTo(0.00077282, 8);
  });
  it("★ 실제 대화의 두 요청이 실제 청구액과 일치한다: 캐시 생성(읽기+쓰기)과 재사용(읽기만) (2026-11-12 실측)", () => {
    const m = "google/gemini-3.8-flash";
    // 생성: 입력 4,498 중 4,497이 cached = cache_write, 출력 74 → 1×0.75 + 4497×(0.075+0.041667) + 74×3.75
    const created = estimateCost(m, { inputTokens: 4498, cachedInputTokens: 4497, cacheWriteTokens: 4497, outputTokens: 74 }, pricing).cost;
    expect(created).toBeCloseTo(0.0008029, 7);
    // 재사용: 입력 4,501 중 4,497이 cached, 쓰기 0, 출력 86 → 4×0.75 + 4497×0.075 + 86×3.75
    const reused = estimateCost(m, { inputTokens: 4501, cachedInputTokens: 4497, cacheWriteTokens: 0, outputTokens: 86 }, pricing).cost;
    expect(reused).toBeCloseTo(0.00066277, 7);
    // 쓰기 토큰이 보고되지 않은 경우(undefined)도 재사용과 같다
    expect(estimateCost(m, { inputTokens: 4501, cachedInputTokens: 4497, outputTokens: 86 }, pricing).cost).toBeCloseTo(reused, 12);
    // 비교: 카드 확장 전, 캐시 없는 3,255토큰 요청(출력 126) = 0.00291375
    expect(estimateCost(m, { inputTokens: 3255, cachedInputTokens: 0, outputTokens: 126 }, pricing).cost).toBeCloseTo(0.00291375, 8);
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
    expect(loadConfig({}).cache).toEqual({ breakpoint: true, minTokens: 3500, lorebookPosition: "afterFixed", breakpointPosition: "fixedBlock", stepTokens: 1500 });
    expect(loadConfig({}).lorebookInlineMaxTokens).toBe(1000);
    expect(loadConfig({ LOREBOOK_INLINE_MAX_TOKENS: "0" }).lorebookInlineMaxTokens).toBe(0);
  });
  it("환경변수로 켠다. 잘못된 값은 오류", () => {
    expect(loadConfig({ CACHE_BREAKPOINT: "0", LOREBOOK_POSITION: "beforeInput", CACHE_MIN_TOKENS: "5000" }).cache).toEqual({ breakpoint: false, minTokens: 5000, lorebookPosition: "beforeInput", breakpointPosition: "fixedBlock", stepTokens: 1500 });
    expect(loadConfig({ CACHE_BREAKPOINT_POSITION: "beforeInput" }).cache.breakpointPosition).toBe("beforeInput");
    expect(loadConfig({ CACHE_BREAKPOINT_POSITION: "stepped", CACHE_STEP_TOKENS: "800" }).cache).toMatchObject({ breakpointPosition: "stepped", stepTokens: 800 });
    expect(loadConfig({ CACHE_BREAKPOINT_POSITION: "fixedBlock" }).cache.breakpointPosition).toBe("fixedBlock");
    expect(() => loadConfig({ CACHE_BREAKPOINT_POSITION: "end" })).toThrow();
    expect(() => loadConfig({ LOREBOOK_POSITION: "middle" })).toThrow();
  });
});
