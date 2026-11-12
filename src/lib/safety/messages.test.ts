import { describe, expect, it } from "vitest";
import { dailyLimitNotice } from "./messages";

describe("dailyLimitNotice", () => {
  it("설정값의 숫자가 문구에 들어간다", () => {
    expect(dailyLimitNotice(50)).toBe("오늘 보낼 수 있는 메시지(50개)를 모두 사용했어요. 내일 다시 이용해 주세요.");
    expect(dailyLimitNotice(7)).toContain("(7개)");
  });
});
