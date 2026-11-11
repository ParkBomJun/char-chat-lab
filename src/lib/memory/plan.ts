export type PlanMessage = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE" };

export type SummaryPlan = {
  /** 이번에 요약에 합칠 메시지(오래된 것부터, 턴 경계에서 끊김) */
  toSummarize: PlanMessage[];
  /** 요약이 덮는 마지막 메시지 id → MemorySummary.coversUntilMsg */
  coversUntilMsg: string;
};

/**
 * 요약 갱신 시점 판단 (SPEC 3-3). 순수 함수.
 *
 * `unsummarized`: 기존 요약이 덮지 않은 메시지 전체(시간순, 회수된 메시지는 제외하고 넘긴다).
 * 한 턴 = USER 메시지로 시작해 다음 USER 메시지 직전까지. 첫 인사(앞쪽 ASSISTANT)는 첫 턴에 붙는다.
 *
 * 원문 턴이 recentTurns + summaryEvery 이상이 되면, 가장 오래된 summaryEvery 턴을 요약으로 보낸다.
 * → 갱신 직후 원문은 recentTurns 턴 이상 남고, 다음 갱신까지 최대 summaryEvery 턴 늘어난다.
 *   이 사이에는 프롬프트의 앞부분(고정+요약+원문 시작점)이 변하지 않아 캐시가 이어진다.
 */
export function planSummarization(
  unsummarized: readonly PlanMessage[],
  cfg: { recentTurns: number; summaryEvery: number },
): SummaryPlan | null {
  const userIdx: number[] = [];
  unsummarized.forEach((m, i) => {
    if (m.role === "USER") userIdx.push(i);
  });
  if (userIdx.length < cfg.recentTurns + cfg.summaryEvery) return null;

  // (summaryEvery+1)번째 USER 메시지가 새 원문 구간의 시작
  const cut = userIdx[cfg.summaryEvery];
  const toSummarize = unsummarized.slice(0, cut);
  return { toSummarize, coversUntilMsg: toSummarize[toSummarize.length - 1].id };
}
