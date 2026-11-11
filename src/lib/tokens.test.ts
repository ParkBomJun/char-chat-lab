import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("빈 문자열은 0", () => expect(estimateTokens("")).toBe(0));
  it("글자 수에 비례", () => expect(estimateTokens("안녕하세요")).toBe(5));
});
