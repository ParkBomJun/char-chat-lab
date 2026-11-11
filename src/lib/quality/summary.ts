import type { ResponseQuality } from "./metrics";

/** 문단 수가 이 값을 넘으면 '문단이 많은 응답'으로 센다 */
export const MANY_PARAGRAPHS_OVER = 4;
export const TOP_ACTIONS = 5;

export type QualitySummary = {
  /** 집계한 응답 수(회수된 응답 제외) */
  n: number;
  /** 한글 비율 기준(환경변수 QUALITY_MIN_HANGUL_RATIO) */
  minHangulRatio: number;
  /** 한글 비율이 기준 미만인 응답(외국어 섞임). 글자가 없는 응답은 세지 않는다 */
  belowHangul: { k: number; rate: number | null };
  /** 한글·라틴 외 문자가 하나라도 섞인 응답과 문자 종류별 응답 수 */
  foreign: { k: number; rate: number | null; byScript: Record<string, number> };
  /** 가장 자주 나온 행동 묘사(괄호 안 문구). 비율 = 그 문구가 한 번이라도 나온 응답 ÷ 전체 응답 */
  topActions: { phrase: string; count: number; rate: number }[];
  /** 행동 묘사가 하나라도 있는 응답 */
  withAction: { k: number; rate: number | null };
  avgLength: number | null;
  manyParagraphs: { k: number; rate: number | null };
  endsWithQuestion: { k: number; rate: number | null };
};

const share = (k: number, n: number) => ({ k, rate: n ? k / n : null });

/** 응답별 지표 → 요약. 관리자 화면과 평가 리포트가 같은 함수를 쓴다. */
export function summarizeQuality(rows: readonly ResponseQuality[], minHangulRatio: number): QualitySummary {
  const n = rows.length;
  const byScript: Record<string, number> = {};
  const phraseCount = new Map<string, number>();
  for (const r of rows) {
    for (const s of new Set(r.foreignScripts)) byScript[s] = (byScript[s] ?? 0) + 1;
    for (const p of new Set(r.actionPhrases)) phraseCount.set(p, (phraseCount.get(p) ?? 0) + 1);
  }
  const topActions = [...phraseCount]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_ACTIONS)
    .map(([phrase, count]) => ({ phrase, count, rate: count / n }));
  return {
    n,
    minHangulRatio,
    belowHangul: share(rows.filter((r) => r.hangulRatio !== null && r.hangulRatio < minHangulRatio).length, n),
    foreign: { ...share(rows.filter((r) => r.foreignScripts.length > 0).length, n), byScript },
    topActions,
    withAction: share(rows.filter((r) => r.actionPhrases.length > 0).length, n),
    avgLength: n ? rows.reduce((a, r) => a + r.length, 0) / n : null,
    manyParagraphs: share(rows.filter((r) => r.paragraphs > MANY_PARAGRAPHS_OVER).length, n),
    endsWithQuestion: share(rows.filter((r) => r.endsWithQuestion).length, n),
  };
}
