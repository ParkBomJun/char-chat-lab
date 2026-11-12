/**
 * 턴당 서버 고정 비용 측정(테스트 서버 전용, 실제 LLM 호출 없음).
 *   1) 터미널 A: npm run dev:test            (3110 포트, 테스트 DB + mock)
 *   2) 터미널 B: npm run bench:turn [-- 20]  (측정할 턴 수, 기본 20. 일일 한도 50 안에서)
 * mock 모델·mock 분류기는 거의 즉시 답하므로, 여기서 나오는 시간은 인증·DB 왕복·규칙 검사 같은 서버 쪽 비용이다
 * (mock 모델은 글자 묶음마다 30ms를 쉬므로 "요청→첫 글자"에는 그 30ms가 들어 있다).
 * 개발 모드 서버는 실행마다 ±20ms쯤 흔들린다. 변경 전후를 비교할 때는 번갈아 여러 번 돌려서 본다.
 * 스크립트가 만든 대화만 지운다.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3110").replace(/\/$/, "");
const jar = new Map<string, string>();
async function http(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...init, headers: { ...(init.headers as Record<string, string>), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of res.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  return res;
}
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (health?.env !== "test") throw new Error(`${BASE}/api/health가 env=test가 아닙니다. npm run dev:test로 띄운 서버에만 실행합니다.`);
  const csrf = (await (await http("/api/auth/csrf")).json()).csrfToken;
  await http("/api/auth/callback/credentials", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf, email: process.env.DEMO_EMAIL!, password: process.env.DEMO_PASSWORD!, callbackUrl: `${BASE}/`, json: "true" }) });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: process.env.DEMO_EMAIL!.toLowerCase() }, select: { id: true } });
  const ch = await prisma.character.findFirstOrThrow({ where: { isPublished: true } });
  const conv = await prisma.conversation.create({ data: { userId: user.id, characterId: ch.id, messages: { create: { role: "ASSISTANT", content: ch.greeting } } }, select: { id: true } });
  const first: number[] = [], tail: number[] = [], total: number[] = [];
  const N = Number(process.argv[2] ?? 20), WARM = 4;
  try {
    for (let i = 0; i < N + WARM; i++) {
      const t0 = performance.now();
      const res = await http(`/api/chat/${conv.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `오늘 읽을 책을 하나 골라 주세요 ${i}` }) });
      if (res.status !== 200) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      let tFirst = 0, tLast = 0; const dec = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        const s = dec.decode(chunk, { stream: true });
        if (s.includes("event: delta")) { const now = performance.now(); if (!tFirst) tFirst = now; tLast = now; }
      }
      const t1 = performance.now();
      if (i >= WARM) { first.push(tFirst - t0); tail.push(t1 - tLast); total.push(t1 - t0); }
    }
  } finally {
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => {});
    await prisma.$disconnect();
  }
  const f = (a: number[]) => `p50 ${pct(a, 50).toFixed(0)}ms · p90 ${pct(a, 90).toFixed(0)}ms · 평균 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)}ms`;
  console.log(`턴 ${N}개(워밍업 ${WARM} 제외)\n  요청→첫 글자:        ${f(first)}\n  마지막 글자→스트림 끝: ${f(tail)}\n  전체:               ${f(total)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
