import { describe, expect, it } from "vitest";
import { kstDayStart, kstListTime, kstNextDayStart, kstStamp, remainingMessages } from "./kst";

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

describe("KST 시각 표기", () => {
  const now = new Date("2026-11-12T12:00:00Z"); // KST 11-12 21:00
  it("오늘은 '오늘 오후 8:49'", () => {
    expect(kstListTime(new Date("2026-11-12T11:49:00Z"), now)).toBe("오늘 오후 8:49");
    expect(kstListTime(new Date("2026-11-11T15:05:00Z"), now)).toBe("오늘 오전 12:05"); // KST 00:05
  });
  it("어제는 '어제 오후 9:01', UTC 날짜가 같아도 KST 기준으로 가른다", () => {
    expect(kstListTime(new Date("2026-11-11T12:01:00Z"), now)).toBe("어제 오후 9:01");
    expect(kstListTime(new Date("2026-11-11T14:59:00Z"), now)).toBe("어제 오후 11:59");
  });
  it("그 밖에는 날짜만", () => {
    expect(kstListTime(new Date("2026-11-10T12:00:00Z"), now)).toBe("11월 10일");
  });
  it("표용 시각은 '11-12 20:48:42'", () => {
    expect(kstStamp(new Date("2026-11-12T11:48:42Z"))).toBe("11-12 20:48:42");
    expect(kstStamp(new Date("2026-01-01T15:00:05Z"))).toBe("01-02 00:00:05");
  });
});
