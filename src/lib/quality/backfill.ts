/**
 * 지표 재계산 대상 고르기(순수 함수). 한 대화의 메시지(시간순)에서 모델이 만든 ASSISTANT 응답만 고른다.
 * 제외: 회수된 메시지, 첫 사용자 메시지보다 앞선 ASSISTANT 메시지(대화를 만들 때 넣는 캐릭터의 첫 인사는 모델 응답이 아니다).
 */
export type BackfillMessage = { id: string; role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; retracted: boolean };

export function pickMetricTargets<T extends BackfillMessage>(messages: readonly T[]): T[] {
  const firstUser = messages.findIndex((m) => m.role === "USER");
  if (firstUser === -1) return [];
  return messages.filter((m, i) => i > firstUser && m.role === "ASSISTANT" && !m.retracted);
}
