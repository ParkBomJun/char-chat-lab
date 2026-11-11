import { describe, expect, it } from "vitest";
import { evaluateFlow, type FlowConfig } from "./flow";

const cfg: FlowConfig = { windowTurns: 5, minTurns: 2, warnThreshold: 0.5, stopStrikes: 2 };
const active = { status: "ACTIVE" as const, strikes: 0 };

describe("evaluateFlow", () => {
  it("낮은 점수가 이어지면 아무 일도 없다", () => {
    expect(evaluateFlow([0, 0.1, 0.2, 0.1], active, cfg)).toMatchObject({ action: "none", status: "ACTIVE" });
  });

  it("한 턴씩은 차단 기준(0.8) 아래여도 여러 턴 평균이 0.5를 넘으면 경고", () => {
    const r = evaluateFlow([0.4, 0.5, 0.6, 0.7], active, cfg);
    expect(r.avg).toBeCloseTo(0.55);
    expect(r).toMatchObject({ action: "warned", status: "WARNED" });
  });

  it("한 번의 튀는 값은 평균에 묻힌다", () => {
    expect(evaluateFlow([0, 0, 0, 0.9], active, cfg).action).toBe("none");
  });

  it("첫 경고는 최소 턴 수(2) 이후에만", () => {
    expect(evaluateFlow([0.9], active, cfg).action).toBe("none");
    expect(evaluateFlow([0.9, 0.9], active, cfg).action).toBe("warned");
  });

  it("경고 뒤에는 1턴만으로도 위반, 두 번째 위반에서 중단", () => {
    const warned = { status: "WARNED" as const, strikes: 0 };
    const first = evaluateFlow([0.9], warned, cfg);
    expect(first).toMatchObject({ action: "strike", status: "WARNED", strikes: 1 });
    const second = evaluateFlow([0.9], { status: "WARNED", strikes: 1 }, cfg);
    expect(second).toMatchObject({ action: "stopped", status: "STOPPED", strikes: 2 });
  });

  it("경고 뒤 점수가 낮으면 위반이 아니다(상태는 WARNED 유지)", () => {
    expect(evaluateFlow([0.1], { status: "WARNED", strikes: 0 }, cfg)).toMatchObject({ action: "none", status: "WARNED" });
  });

  it("중단된 대화는 더 바뀌지 않는다", () => {
    expect(evaluateFlow([1, 1, 1], { status: "STOPPED", strikes: 2 }, cfg).action).toBe("none");
  });

  it("윈도우는 최근 N턴만 본다", () => {
    expect(evaluateFlow([1, 1, 1, 0, 0, 0, 0, 0], active, cfg).avg).toBe(0);
  });

  it("빈 입력은 안전", () => {
    expect(evaluateFlow([], active, cfg)).toMatchObject({ avg: 0, action: "none" });
  });
});
