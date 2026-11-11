/** 한국 표준시(UTC+9, 서머타임 없음) 기준 날짜 계산. 일일 사용량의 경계와 관리자 통계의 날짜 묶음에 쓴다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 주어진 시각이 속한 KST 날짜의 자정(UTC 시각으로 반환) */
export function kstDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - KST_OFFSET_MS);
}

/** 다음 KST 자정 */
export function kstNextDayStart(now: Date = new Date()): Date {
  return new Date(kstDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

export function remainingMessages(limit: number, used: number): number {
  return Math.max(0, limit - used);
}
