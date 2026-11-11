import { describe, expect, it } from "vitest";
import { SAFETY_INSTRUCTION, buildSimpleMessages } from "./simple-prompt";

const card = { name: "하루", persona: "P", speechStyle: "S", exampleDialog: "E" };

describe("buildSimpleMessages", () => {
  it("system이 맨 앞이고 안전 지시가 캐릭터 설정보다 앞", () => {
    const [sys] = buildSimpleMessages(card, []);
    expect(sys.role).toBe("system");
    expect(sys.content.startsWith(SAFETY_INSTRUCTION)).toBe(true);
    expect(sys.content.indexOf(SAFETY_INSTRUCTION)).toBeLessThan(sys.content.indexOf("하루"));
  });
  it("대화 순서 유지, SYSTEM_NOTICE 제외", () => {
    const msgs = buildSimpleMessages(card, [
      { role: "ASSISTANT", content: "인사" },
      { role: "USER", content: "질문" },
      { role: "SYSTEM_NOTICE", content: "안내" },
    ]);
    expect(msgs.slice(1)).toEqual([
      { role: "assistant", content: "인사" },
      { role: "user", content: "질문" },
    ]);
  });
});
