/**
 * 레드팀 실제 실행 가드. OpenRouter는 승인 없는 레드팀(공격 프롬프트를 실제 모델에 보내는 시험)을 금지한다.
 * 공격 케이스가 하나라도 들어간 실제 실행은 사용자가 승인을 받았다고 명시(REDTEAM_APPROVED=1)해야 시작한다.
 * mock 실행, 정상 케이스만의 실행(--benign-only), 규칙 층만의 평가(--rules-only)는 모델에 공격 문구를 보내지 않으므로 해당 없다.
 */
export const REDTEAM_POLICY_URL = "https://openrouter.ai/docs/cookbook/evaluate-and-optimize/red-teaming";

export function redteamApprovalError(o: { real: boolean; attackCases: number; env?: Record<string, string | undefined> }): string | null {
  if (!o.real || o.attackCases === 0) return null;
  if ((o.env ?? process.env).REDTEAM_APPROVED === "1") return null;
  return (
    `공격 케이스 ${o.attackCases}개가 포함된 실제 실행은 시작하지 않습니다. OpenRouter는 승인 없는 레드팀을 금지합니다: ${REDTEAM_POLICY_URL}\n` +
    "제공사의 승인을 받았다면 REDTEAM_APPROVED=1을 지정해 다시 실행하세요. 승인 없이 할 수 있는 것: --benign-only(정상 케이스만 실제 모델로), --rules-only(모델 호출 없이 규칙 층만), mock 실행.\n" +
    "아무것도 호출하지 않았습니다."
  );
}
