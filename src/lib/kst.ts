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

const pad2 = (n: number) => String(n).padStart(2, "0");
/** KST 기준 달력 값. UTC 접근자로 읽는다. */
const kstParts = (d: Date) => {
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  return { month: s.getUTCMonth() + 1, day: s.getUTCDate(), h: s.getUTCHours(), m: s.getUTCMinutes(), s: s.getUTCSeconds() };
};

/** 목록용 시각: 오늘이면 "오늘 오후 8:49", 어제면 "어제 오후 9:01", 그 밖에는 "11월 11일" (KST) */
export function kstListTime(at: Date, now: Date = new Date()): string {
  const p = kstParts(at);
  const days = Math.round((kstDayStart(now).getTime() - kstDayStart(at).getTime()) / (24 * 60 * 60 * 1000));
  const clock = `${p.h < 12 ? "오전" : "오후"} ${p.h % 12 || 12}:${pad2(p.m)}`;
  if (days === 0) return `오늘 ${clock}`;
  if (days === 1) return `어제 ${clock}`;
  return `${p.month}월 ${p.day}일`;
}

/** 표용 시각: "11-12 20:48:42" (KST) */
export function kstStamp(at: Date): string {
  const p = kstParts(at);
  return `${pad2(p.month)}-${pad2(p.day)} ${pad2(p.h)}:${pad2(p.m)}:${pad2(p.s)}`;
}
