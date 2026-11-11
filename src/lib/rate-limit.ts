/** 시도 제한의 순수 로직. DB 접근은 rate-limit-db.ts. */

export type Policy = { max: number; windowMs: number };

const MIN = 60 * 1000;
export const LOGIN_POLICY = {
  /** 같은 이메일을 같은 IP에서 계속 시도(비밀번호 추측) */
  perEmailIp: { max: 5, windowMs: 15 * MIN } satisfies Policy,
  /** 한 IP가 여러 이메일을 돌려 가며 시도(크리덴셜 스터핑) */
  perIp: { max: 20, windowMs: 15 * MIN } satisfies Policy,
};
export const SIGNUP_POLICY = { perIp: { max: 10, windowMs: 60 * MIN } satisfies Policy };

export const limited = (count: number, policy: Policy) => count >= policy.max;

export const normalizeEmailKey = (email: string) => email.trim().toLowerCase().slice(0, 254);

type HeaderGetter = { get(name: string): string | null };

/**
 * 클라이언트 IP. X-Forwarded-For는 클라이언트가 임의로 채울 수 있어 맨 앞 값을 믿으면 우회된다.
 * 신뢰하는 프록시가 값을 덧붙이므로 "오른쪽에서 hops번째"를 쓴다(기본 1 = 바로 앞 프록시가 본 주소).
 * 프록시 뒤가 아니면(헤더 없음) "unknown" — 이 경우 모든 요청이 한 IP로 묶이므로 반드시 프록시 뒤에 둔다.
 */
export function clientIp(headers: HeaderGetter, hops = 1): string {
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "unknown";
  const idx = parts.length - Math.max(1, hops);
  return (idx >= 0 ? parts[idx] : parts[0]).slice(0, 64);
}

/** 가장 오래된 시도가 창에서 빠져나가 다시 시도할 수 있게 될 때까지(초). */
export function retryAfterSeconds(oldest: Date | null, policy: Policy, now: Date = new Date()): number {
  if (!oldest) return 0;
  return Math.max(0, Math.ceil((oldest.getTime() + policy.windowMs - now.getTime()) / 1000));
}
