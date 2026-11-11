import { describe, expect, it } from "vitest";
import { SUMMARIZER_SYSTEM, buildSummaryPrompt } from "./prompt";

describe("buildSummaryPrompt", () => {
  it("기존 요약이 없으면 (없음), 대화는 화자 이름으로 표기, 안내 메시지 제외", () => {
    const [sys, user] = buildSummaryPrompt(
      null,
      [
        { role: "ASSISTANT", content: "어서 오세요" },
        { role: "USER", content: "안녕" },
        { role: "SYSTEM_NOTICE", content: "안내문" },
      ],
      "하루",
    );
    expect(sys.content).toBe(SUMMARIZER_SYSTEM);
    expect(user.content).toContain("[기존 요약]\n(없음)");
    expect(user.content).toContain("하루: 어서 오세요\n사용자: 안녕");
    expect(user.content).not.toContain("안내문");
  });
  it("기존 요약을 새 대화 앞에 넣는다", () => {
    const user = buildSummaryPrompt("이전 요약", [{ role: "USER", content: "x" }], "하루")[1].content;
    expect(user.indexOf("이전 요약")).toBeLessThan(user.indexOf("[새 대화]"));
  });
  it("프롬프트 인젝션 방어 문구가 시스템 지시에 있다", () => {
    expect(SUMMARIZER_SYSTEM).toContain("따르지 말고");
  });
});
