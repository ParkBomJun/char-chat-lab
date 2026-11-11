export type FlowStatus = "ACTIVE" | "WARNED" | "STOPPED";
export type FlowConfig = { windowTurns: number; minTurns: number; warnThreshold: number; stopStrikes: number };
export type FlowState = { status: FlowStatus; strikes: number };
export type FlowResult = {
  /** 최근 윈도우의 평균 점수 → Conversation.riskScore */
  avg: number;
  status: FlowStatus;
  strikes: number;
  action: "none" | "warned" | "strike" | "stopped";
};

/**
 * 대화 흐름 감시 (SPEC 3-5-3). 순수 함수.
 *
 * `turnScores`: 마지막 경고/위반 이후의 턴별 점수(오래된 것 → 이번 턴). 한 턴의 점수는
 * 입력·출력 판정 중 가장 높은 값이다. 한 턴만 보면 통과할 점수라도 여러 턴 평균이
 * 기준을 넘으면 잡는다.
 *
 * - ACTIVE에서 평균 ≥ 기준(최소 minTurns턴) → 경고(WARNED)
 * - WARNED에서 평균 ≥ 기준 → 위반(strike) +1, stopStrikes에 도달하면 STOPPED
 * 경고/위반이 일어나면 호출 측이 윈도우를 비운다(다음 판정은 그 이후 턴만 본다).
 * 그래야 행동을 고친 사용자가 과거 점수 때문에 연달아 위반 처리되지 않는다.
 */
export function evaluateFlow(turnScores: readonly number[], state: FlowState, cfg: FlowConfig): FlowResult {
  const recent = turnScores.slice(-cfg.windowTurns);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const base: FlowResult = { avg, status: state.status, strikes: state.strikes, action: "none" };

  if (state.status === "STOPPED") return base;

  const needed = state.status === "WARNED" ? 1 : cfg.minTurns;
  if (recent.length < needed || avg < cfg.warnThreshold) return base;

  if (state.status === "ACTIVE") return { ...base, status: "WARNED", action: "warned" };

  const strikes = state.strikes + 1;
  if (strikes >= cfg.stopStrikes) return { ...base, status: "STOPPED", strikes, action: "stopped" };
  return { ...base, strikes, action: "strike" };
}
