/** 한국어 짧은 명사("책", "물")는 오탐이 너무 많아 키워드로 쓰지 않는다. 공백 제거 후 기준. */
export const MIN_KEYWORD_LENGTH = 2;
export const MAX_KEYWORDS_PER_ENTRY = 20;
export const MAX_KEYWORD_LENGTH = 40;

/** 매칭용 정규화: NFC, 소문자, 모든 공백 제거. 키워드와 대화 텍스트 양쪽에 같은 규칙을 쓴다. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

export type KeywordValidation = { keywords: string[]; errors: string[] };

/**
 * 관리자 화면(7단계)과 seed에서 쓰는 키워드 검증.
 * 앞뒤 공백 제거, 정규화 기준 중복 제거, 너무 짧거나 긴 키워드 거절.
 */
export function validateKeywords(raw: readonly string[]): KeywordValidation {
  const errors: string[] = [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const r of raw) {
    const k = r.trim();
    if (!k) continue;
    const norm = normalizeForMatch(k);
    if (norm.length < MIN_KEYWORD_LENGTH) {
      errors.push(`"${k}": 키워드는 공백을 뺀 ${MIN_KEYWORD_LENGTH}글자 이상이어야 합니다.`);
      continue;
    }
    if (k.length > MAX_KEYWORD_LENGTH) {
      errors.push(`"${k.slice(0, 10)}…": 키워드는 ${MAX_KEYWORD_LENGTH}자 이하여야 합니다.`);
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);
    keywords.push(k);
  }
  if (keywords.length > MAX_KEYWORDS_PER_ENTRY) {
    errors.push(`키워드는 항목당 최대 ${MAX_KEYWORDS_PER_ENTRY}개입니다.`);
  }
  if (keywords.length === 0 && errors.length === 0) errors.push("키워드가 하나 이상 필요합니다.");
  return { keywords: keywords.slice(0, MAX_KEYWORDS_PER_ENTRY), errors };
}
