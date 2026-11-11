import { describe, expect, it } from "vitest";
import { kstDayStart, kstNextDayStart, remainingMessages } from "./kst";

describe("KST 날짜 경계", () => {
  it("KST 자정 직전/직후는 서로 다른 날", () => {
    // 2026-11-11 14:59:59Z = KST 23:59:59 (11일), 15:00:00Z = KST 00:00:00 (12일)
    const before = kstDayStart(new Date("2026-11-11T14:59:59Z"));
    const after = kstDayStart(new Date("2026-11-11T15:00:00Z"));
    expect(before.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(after.toISOString()).toBe("2026-11-11T15:00:00.000Z");
  });
  it("UTC 날짜가 바뀌기 전이어도 KST 아침은 그날 자정이 기준", () => {
    // UTC 2026-11-11 01:00 = KST 10:00 (11일) → 시작은 UTC 2026-11-10 15:00
    expect(kstDayStart(new Date("2026-11-11T01:00:00Z")).toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });
  it("다음 날 자정은 정확히 24시간 뒤", () => {
    const now = new Date("2026-11-11T05:00:00Z");
    expect(kstNextDayStart(now).getTime() - kstDayStart(now).getTime()).toBe(24 * 3600 * 1000);
  });
  it("remainingMessages는 음수가 되지 않는다", () => {
    expect(remainingMessages(50, 10)).toBe(40);
    expect(remainingMessages(50, 50)).toBe(0);
    expect(remainingMessages(50, 80)).toBe(0);
  });
});
