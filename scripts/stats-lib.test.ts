import { describe, expect, it } from "vitest";
import { calibrate, quantile } from "./stats-lib";

describe("quantile", () => {
  it("선형 보간, 빈 배열은 null", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5], 0.95)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 10);
    expect(quantile([3, 1, 2], 0)).toBe(1);
  });
});

describe("calibrate", () => {
  it("실제 = 0.55 × 추정 이면 배율 0.55, 직선 기울기 0.55", () => {
    const rows = [1000, 2000, 4000, 8000].map((est) => ({ model: "m", est, input: est * 0.55 }));
    const c = calibrate(rows);
    expect(c.n).toBe(4);
    expect(c.weighted).toBeCloseTo(0.55, 10);
    expect(c.median).toBeCloseTo(0.55, 10);
    expect(c.fit!.a).toBeCloseTo(0.55, 10);
    expect(c.fit!.b).toBeCloseTo(0, 6);
  });
  it("추정 0 이하·입력 0 이하 행은 제외, 점이 없으면 null", () => {
    expect(calibrate([{ model: "m", est: 0, input: 5 }, { model: "m", est: 5, input: 0 }])).toEqual({ n: 0, weighted: null, median: null, p10: null, p90: null, fit: null });
  });
  it("추정값이 모두 같으면 직선은 null(기울기 정의 불가), 배율은 계산", () => {
    const c = calibrate([{ model: "m", est: 100, input: 50 }, { model: "m", est: 100, input: 60 }]);
    expect(c.fit).toBeNull();
    expect(c.weighted).toBeCloseTo(0.55, 10);
  });
});
