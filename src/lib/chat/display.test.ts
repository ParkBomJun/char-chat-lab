import { describe, expect, it } from "vitest";
import { NOTICE } from "@/lib/safety/messages";
import { splitActions, splitHotlines, subjectParticle } from "./display";

describe("화면 표시 도우미", () => {
  it("주격 조사는 받침에 따라 고른다", () => {
    expect(subjectParticle("하루")).toBe("가");
    expect(subjectParticle("가람")).toBe("이");
    expect(subjectParticle("Haru")).toBe("가");
    expect(subjectParticle("")).toBe("가");
  });
  it("괄호 안 행동 묘사만 가려내고 원문은 그대로다", () => {
    const line = "음… (찻장 쪽을 보며) 마침 캐모마일이 있어요. (웃음)";
    const pieces = splitActions(line);
    expect(pieces.filter((p) => p.act).map((p) => p.text)).toEqual(["(찻장 쪽을 보며)", "(웃음)"]);
    expect(pieces.map((p) => p.text).join("")).toBe(line);
  });
  it("괄호가 없거나 너무 길면 그대로 둔다", () => {
    expect(splitActions("괄호 없음")).toEqual([{ text: "괄호 없음", act: false }]);
    const long = `(${"가".repeat(41)})`;
    expect(splitActions(long)).toEqual([{ text: long, act: false }]);
  });
  it("위기 안내문의 번호 셋을 가려내고 문구는 바꾸지 않는다", () => {
    const body = NOTICE.crisis.split("\n")[1];
    const pieces = splitHotlines(body);
    expect(pieces.filter((p) => p.strong).map((p) => p.text)).toEqual(["109", "112", "119"]);
    expect(pieces.map((p) => p.text).join("")).toBe(body);
    expect(splitHotlines("1099호")).toEqual([{ text: "1099호", strong: false }]);
  });
  it("위기 안내문은 세 줄이다(카드의 제목·본문·끝 문장에 그대로 쓴다)", () => {
    expect(NOTICE.crisis.split("\n")).toHaveLength(3);
  });
});
