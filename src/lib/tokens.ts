/**
 * 토큰 수 대략 추정 = 글자 수. 한국어는 글자당 ~1토큰으로 보수적으로 잡는다(실측으로는 실제 토큰이 약 0.55~0.6배).
 * PROMPT_TOKEN_BUDGET 등 예산 설정과 blockTokens 기록이 모두 이 단위다. 정확한 값은 제공사 응답의 usage를 쓴다.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length);
}
