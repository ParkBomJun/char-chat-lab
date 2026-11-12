import { describe, expect, it } from "vitest";
import { homeConversationWhere } from "./home-list";

describe("homeConversationWhere", () => {
  it("본인 대화 중 사용자 메시지가 하나라도 있는 것만 고른다", () => {
    expect(homeConversationWhere("u1")).toEqual({ userId: "u1", messages: { some: { role: "USER" } } });
  });

  it("첫 인사만 있는 대화는 조건에 맞지 않는다(조건을 메모리에서 흉내 내 확인)", () => {
    const where = homeConversationWhere("u1");
    const role = (where.messages as { some: { role: string } }).some.role;
    const matches = (c: { userId: string; messages: { role: string }[] }) => c.userId === where.userId && c.messages.some((m) => m.role === role);
    expect(matches({ userId: "u1", messages: [{ role: "ASSISTANT" }] })).toBe(false);
    expect(matches({ userId: "u1", messages: [] })).toBe(false);
    expect(matches({ userId: "u1", messages: [{ role: "ASSISTANT" }, { role: "USER" }] })).toBe(true);
    expect(matches({ userId: "u2", messages: [{ role: "USER" }] })).toBe(false);
  });
});
