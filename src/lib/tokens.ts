/** 토큰 수 대략 추정. 한국어는 글자당 ~1토큰으로 보수적으로 잡는다. 정확한 값은 제공사 응답의 usage를 쓴다. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length);
}
