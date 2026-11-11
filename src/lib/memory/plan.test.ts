import { describe, expect, it } from "vitest";
import { planSummarization, type PlanMessage } from "./plan";

const cfg = { recentTurns: 20, summaryEvery: 10 };

/** 첫 인사 + n턴(USER, ASSISTANT). id: g, u1, a1, u2, a2 … */
function convo(turns: number, greeting = true): PlanMessage[] {
  const out: PlanMessage[] = greeting ? [{ id: "g", role: "ASSISTANT" }] : [];
  for (let i = 1; i <= turns; i++) {
    out.push({ id: `u${i}`, role: "USER" }, { id: `a${i}`, role: "ASSISTANT" });
  }
  return out;
}

describe("planSummarization", () => {
  it("턴이 recent+every(30) 미만이면 요약하지 않는다", () => {
    expect(planSummarization(convo(29), cfg)).toBeNull();
    expect(planSummarization([], cfg)).toBeNull();
  });

  it("정확히 30턴이 되면 가장 오래된 10턴(첫 인사 포함)을 요약", () => {
    const plan = planSummarization(convo(30), cfg)!;
    expect(plan.toSummarize[0].id).toBe("g");
    expect(plan.toSummarize.at(-1)?.id).toBe("a10");
    expect(plan.coversUntilMsg).toBe("a10");
    expect(plan.toSummarize.length).toBe(1 + 20);
  });

  it("턴 경계에서만 끊는다: 사용자 메시지와 그 답변이 갈라지지 않는다", () => {
    const plan = planSummarization(convo(35), cfg)!;
    expect(plan.toSummarize.at(-1)?.role).toBe("ASSISTANT");
    expect(plan.coversUntilMsg).toBe("a10");
  });

  it("답변이 아직 없는 마지막 턴(USER로 끝남)이어도 경계는 같다", () => {
    const msgs = [...convo(29), { id: "u30", role: "USER" as const }];
    const plan = planSummarization(msgs, cfg)!;
    expect(plan.coversUntilMsg).toBe("a10");
  });

  it("갱신 직후(남은 원문 20턴)에는 다시 요약하지 않고, 10턴 더 쌓이면 다음 10턴을 요약", () => {
    const first = planSummarization(convo(30), cfg)!;
    const rest = convo(30).slice(first.toSummarize.length);
    expect(rest.filter((m) => m.role === "USER").length).toBe(20);
    expect(planSummarization(rest, cfg)).toBeNull();

    const grown = convo(40).slice(first.toSummarize.length);
    const second = planSummarization(grown, cfg)!;
    expect(second.toSummarize[0].id).toBe("u11");
    expect(second.coversUntilMsg).toBe("a20");
  });

  it("SYSTEM_NOTICE는 턴 수에 들어가지 않는다", () => {
    const msgs = convo(29);
    msgs.splice(5, 0, { id: "n1", role: "SYSTEM_NOTICE" });
    expect(planSummarization(msgs, cfg)).toBeNull();
  });

  it("recentTurns/summaryEvery 설정을 따른다", () => {
    const plan = planSummarization(convo(5, false), { recentTurns: 3, summaryEvery: 2 })!;
    expect(plan.toSummarize.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });
});
