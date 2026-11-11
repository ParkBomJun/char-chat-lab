import { describe, expect, it } from "vitest";
import { cacheHitRate, fmtCost, fmtMs, fmtPct, periodStart } from "./stats";

describe("관리자 통계 헬퍼", () => {
  it("캐시 적중률: 입력이 없으면 null(0%가 아님)", () => {
    expect(cacheHitRate(0, 0)).toBeNull();
    expect(cacheHitRate(40, 100)).toBe(0.4);
    expect(fmtPct(cacheHitRate(1, 3))).toBe("33.3%");
    expect(fmtPct(null)).toBe("—");
  });
  it("비용·지연 표기", () => {
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(0.000586)).toBe("$0.000586");
    expect(fmtCost(1.5)).toBe("$1.5000");
    expect(fmtMs(1234.6)).toBe("1235ms");
    expect(fmtMs(null)).toBe("—");
  });
  it("조회 구간: days=1은 오늘(KST)만, days=7은 6일 전 자정부터", () => {
    const now = new Date("2026-11-11T05:00:00Z"); // KST 11일 14:00
    expect(periodStart(1, now).toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(periodStart(7, now).toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });
});
