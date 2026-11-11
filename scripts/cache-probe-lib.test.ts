import { describe, expect, it } from "vitest";
import { comparePrefix, firstDiffSnippet, sha } from "./cache-probe-lib";

const m = (role: "system" | "user" | "assistant", content: string) => ({ role, content });

describe("comparePrefix", () => {
  const fixed = m("system", "고정 블록");
  it("완전히 같은 접두사 + 뒤에 메시지가 늘어난 경우(이상적): a 전체가 b의 접두사", () => {
    const a = [fixed, m("user", "q1")];
    const b = [fixed, m("user", "q1"), m("assistant", "a1"), m("user", "q2")];
    expect(comparePrefix(a, b)).toMatchObject({ sameMessages: 2, firstDiffIndex: null, aIsPrefixOfB: true });
  });
  it("★ 고정 블록 바로 뒤에 새 system(로어북)이 끼면 접두사는 고정 블록 하나뿐", () => {
    const a = [fixed, m("assistant", "인사"), m("user", "q1")];
    const b = [fixed, m("system", "# 참고 설정\n- 새 항목"), m("assistant", "인사"), m("user", "q1"), m("assistant", "a1"), m("user", "q2")];
    const r = comparePrefix(a, b);
    expect(r).toMatchObject({ sameMessages: 1, firstDiffIndex: 1, aIsPrefixOfB: false });
    expect(r.sameChars).toBe("고정 블록".length);
  });
  it("공백 한 칸 차이도 다른 것으로 본다(바이트 단위)", () => {
    expect(comparePrefix([m("system", "a b")], [m("system", "a  b")]).sameMessages).toBe(0);
  });
  it("역할이 다르면 다른 메시지", () => {
    expect(comparePrefix([m("system", "x")], [m("user", "x")]).sameMessages).toBe(0);
  });
});

describe("진단 헬퍼", () => {
  it("firstDiffSnippet / sha", () => {
    expect(firstDiffSnippet("abc", "abc")).toBe("(동일)");
    expect(firstDiffSnippet("abcdef", "abcXef", 2)).toContain("위치 3");
    expect(sha("x")).toHaveLength(12);
    expect(sha("x")).not.toBe(sha("y"));
  });
});
