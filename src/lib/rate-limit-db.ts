import { prisma } from "@/lib/db";
import { LOGIN_POLICY, SIGNUP_POLICY, clientIp, limited, normalizeEmailKey, type Policy } from "@/lib/rate-limit";

const DAY_MS = 24 * 60 * 60 * 1000;

const count = (scope: string, key: string, policy: Policy) =>
  prisma.rateLimitEvent.count({ where: { scope, key, createdAt: { gte: new Date(Date.now() - policy.windowMs) } } });

async function record(scope: string, key: string) {
  await prisma.rateLimitEvent.create({ data: { scope, key } });
  // 오래된 기록 정리(하루 지난 것). 인덱스가 있는 작은 테이블이라 요청마다 해도 부담이 없다.
  await prisma.rateLimitEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - DAY_MS) } } });
}

const loginKeys = (email: string, ip: string) => ({ emailIp: `${normalizeEmailKey(email)}|${ip}`, ip });

export const requestIp = (headers: { get(name: string): string | null }) =>
  clientIp(headers, Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1));

/** 로그인 시도 전에 호출: 한도를 넘었으면 true. 비밀번호 검사보다 먼저 막아 추측 속도를 제한한다. */
export async function isLoginThrottled(email: string, ip: string): Promise<boolean> {
  const k = loginKeys(email, ip);
  const [a, b] = await Promise.all([
    count("login_fail", k.emailIp, LOGIN_POLICY.perEmailIp),
    count("login_fail", k.ip, LOGIN_POLICY.perIp),
  ]);
  return limited(a, LOGIN_POLICY.perEmailIp) || limited(b, LOGIN_POLICY.perIp);
}

/** 실패 기록. 존재하지 않는 이메일도 똑같이 센다(계정 존재 여부가 드러나지 않게). */
export async function recordLoginFailure(email: string, ip: string) {
  const k = loginKeys(email, ip);
  await record("login_fail", k.emailIp);
  await record("login_fail", k.ip);
}

/** 성공하면 그 이메일+IP 조합의 실패 기록만 지운다(IP 전체 기록은 남겨 스터핑 한도를 유지). */
export async function clearLoginFailures(email: string, ip: string) {
  await prisma.rateLimitEvent.deleteMany({ where: { scope: "login_fail", key: loginKeys(email, ip).emailIp } });
}

/** 가입 시도 제한: 한도를 넘었으면 true, 아니면 이번 시도를 기록하고 false. */
export async function signupThrottled(ip: string): Promise<boolean> {
  if (limited(await count("signup", ip, SIGNUP_POLICY.perIp), SIGNUP_POLICY.perIp)) return true;
  await record("signup", ip);
  return false;
}
