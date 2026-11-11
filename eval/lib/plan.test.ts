import { describe, expect, it } from "vitest";
import { estimatePlan } from "./plan";

const table = {
  default: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },
  models: { chat: { inputPer1M: 1_000_000, cachedInputPer1M: 0, outputPer1M: 2_000_000 }, light: { inputPer1M: 100_000, cachedInputPer1M: 0, outputPer1M: 200_000 } },
};
const base = { fixedChars: 1000, generate: true, appSafety: true, maxOutputTokens: 1000, promptTokenBudget: 100_000, chatModel: "chat", lightModel: "light", table };

describe("estimatePlan", () => {
  it("앱 안전 ON: 턴당 대화 1 + 분류기 2회", () => {
    const p = estimatePlan({ ...base, convs: [["가나다", "라마바"], ["사아자"]] });
    expect(p).toMatchObject({ turns: 3, chatCalls: 3, classifierCalls: 6, calls: 9 });
    expect(p.cost).toBeGreaterThan(0);
  });
  it("--no-app-safety: 분류기 호출 없음", () => {
    const p = estimatePlan({ ...base, appSafety: false, convs: [["가나다", "라마바"]] });
    expect(p).toMatchObject({ chatCalls: 2, classifierCalls: 0, calls: 2 });
  });
  it("입력 검사만(generate=false): 턴당 분류기 1회, 대화 호출 없음", () => {
    expect(estimatePlan({ ...base, generate: false, convs: [["가", "나"]] })).toMatchObject({ chatCalls: 0, classifierCalls: 2 });
  });
  it("대화가 길어질수록 입력 토큰이 늘고, 예산을 넘지 않는다", () => {
    const one = estimatePlan({ ...base, appSafety: false, convs: [["가".repeat(100)]] }).inputTokens;
    const five = estimatePlan({ ...base, appSafety: false, convs: [Array(5).fill("가".repeat(100))] }).inputTokens;
    expect(five).toBeGreaterThan(one * 5);
    expect(estimatePlan({ ...base, appSafety: false, promptTokenBudget: 100, convs: [Array(5).fill("가".repeat(100))] }).inputTokens).toBe(500);
  });
  it("단가가 없거나 0이면 비용은 null(0으로 속이지 않는다)", () => {
    expect(estimatePlan({ ...base, chatModel: "unknown", convs: [["가"]] }).cost).toBeNull();
  });
});
