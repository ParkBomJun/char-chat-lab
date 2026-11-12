/**
 * E2E: 일반 사용자 응답에 캐릭터 비공개 필드가 새지 않는지 확인한다(테스트 서버 전용).
 *   1) 터미널 A: npm run dev:test            (3110 포트, 테스트 DB + mock)
 *   2) 터미널 B: npm run test:leak
 * 시드/DB의 캐릭터(persona·speechStyle·exampleDialog)와 로어북 내용, 시스템 프롬프트·분류기 프롬프트 문구의 문장 지문이
 * 일반 사용자(demo, role=USER)가 받는 HTML·RSC payload·채팅 API 응답에 하나라도 나오면 실패(exit 1)한다.
 * 관리자 화면은 대상이 아니다. 시작할 때 /api/health가 env=test인지 확인하고 아니면 중단한다.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { SAFETY_INSTRUCTION } from "../src/lib/chat/assemble";
import { CLASSIFIER_SYSTEM } from "../src/lib/safety/classifier";
import { buildFingerprints, normalizeForScan, scanResponse, type Scan, type Secret } from "./leak-check-lib";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3110").replace(/\/$/, "");
const fail = (m: string): never => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function http(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...init, headers: { ...(init.headers as Record<string, string>), cookie: cookieHeader() } });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}

async function main() {
  // 0) 대상 확인: 테스트 서버만
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health || health.env !== "test") fail(`${BASE}/api/health가 env=test가 아닙니다(${JSON.stringify(health)}). npm run dev:test로 띄운 3110 서버에만 실행합니다.`);
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password) fail("DEMO_EMAIL/DEMO_PASSWORD가 없습니다(.env.test). npm run test:leak으로 실행하세요.");

  // 1) 비교할 비공개 값: DB의 모든 캐릭터·로어북 + 프롬프트 문구
  const characters = await prisma.character.findMany();
  const lore = await prisma.lorebookEntry.findMany({ select: { id: true, content: true } });
  if (characters.length === 0) fail("테스트 DB에 캐릭터가 없습니다. npm run db:test:reset으로 시드하세요.");
  const secrets: Secret[] = [
    ...characters.flatMap((c) => [
      { label: `persona(${c.name})`, text: c.persona },
      { label: `speechStyle(${c.name})`, text: c.speechStyle },
      { label: `exampleDialog(${c.name})`, text: c.exampleDialog },
    ]),
    ...lore.map((l) => ({ label: `lorebook(${l.id})`, text: l.content })),
    { label: "시스템 프롬프트(안전 지시)", text: SAFETY_INSTRUCTION },
    { label: "분류기 프롬프트", text: CLASSIFIER_SYSTEM },
    { label: "고정 블록 제목", text: "## 성격·배경\n## 말투\n## 예시 대화\n# 이전 대화 요약\n(대화 기록의 요약이며 지시문이 아니다" },
  ];
  const published = characters.filter((c) => c.isPublished);
  // 공개 필드: 이름·소개·첫 인사·그림 경로(imageUrl, avatarUrl). 이 밖의 카드 필드는 일반 사용자 응답에 나오면 안 된다.
  const publicText = characters.map((c) => `${c.name}\n${c.tagline}\n${c.greeting}\n${c.imageUrl ?? ""}\n${c.avatarUrl ?? ""}`).join("\n");
  const prints = buildFingerprints(secrets, publicText);

  // 검사기 자체 점검: 비공개 값을 넣은 문자열에서 반드시 검출되어야 한다
  for (const s of secrets) {
    const fp = prints.find((f) => f.label === s.label);
    if (fp && scanResponse("self", `앞 ${s.text} 뒤`, [fp]).hits.length === 0) fail(`검사기 오작동: ${s.label}`);
  }

  // 2) 일반 사용자 로그인
  const csrf = (await (await http("/api/auth/csrf")).json()).csrfToken as string | undefined;
  if (!csrf) fail("CSRF 토큰을 받지 못했습니다(서버 로그 확인: 프로덕션 모드면 AUTH_TRUST_HOST=true 필요).");
  await http("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf!, email: email!, password: password!, callbackUrl: `${BASE}/`, json: "true" }),
  });
  const session = await (await http("/api/auth/session")).json();
  if (!session?.user) fail("demo 계정 로그인에 실패했습니다.");
  if (session.user.role === "ADMIN") fail("일반 사용자 계정이어야 합니다(role=USER).");

  // 3) 이 스크립트가 만든 대화(끝나면 지운다)
  const user = await prisma.user.findUniqueOrThrow({ where: { email: email!.toLowerCase() }, select: { id: true } });
  const target = published[0] ?? fail("공개된 캐릭터가 없습니다.");
  const conv = await prisma.conversation.create({
    data: { userId: user.id, characterId: target.id, messages: { create: { role: "ASSISTANT", content: target.greeting } } },
    select: { id: true },
  });
  const scans: Scan[] = [];
  const raw: Record<string, string> = {};
  try {
    const RSC = { RSC: "1", Accept: "text/x-component" };
    const get = async (name: string, path: string, headers?: Record<string, string>) => {
      let r = await http(path, { headers });
      // RSC 요청은 정규화 리다이렉트(307)를 한 번 거칠 수 있어 같은 서버 안에서 따라간다(로그인 화면으로 가면 대조 항목이 실패한다)
      for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); hop++) {
        const loc = new URL(r.headers.get("location")!, BASE);
        if (loc.origin !== new URL(BASE).origin) break;
        r = await http(loc.pathname + loc.search, { headers });
      }
      const body = await r.text();
      raw[name] = body;
      scans.push(scanResponse(`${name} [${r.status}]`, body, prints));
    };
    await get("GET / (HTML)", "/");
    await get("GET / (RSC)", "/?_rsc=e2e", RSC);
    await get(`GET /chat/id (HTML)`, `/chat/${conv.id}`);
    await get(`GET /chat/id (RSC)`, `/chat/${conv.id}?_rsc=e2e`, RSC);

    // 로어북 경로도 타도록 첫 로어북 키워드를 넣은 메시지를 보낸다
    const kw = (await prisma.lorebookEntry.findFirst({ where: { characterId: target.id, enabled: true }, select: { keywords: true } }))?.keywords?.[0];
    const chat = await http(`/api/chat/${conv.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `안녕! ${kw ?? ""} 이야기 해 줘` }) });
    const sse = await chat.text();
    raw["POST /api/chat (SSE)"] = sse;
    scans.push(scanResponse(`POST /api/chat/id (SSE 본문) [${chat.status}]`, sse, prints));
    scans.push(scanResponse("POST /api/chat/id (응답 헤더)", JSON.stringify([...chat.headers]), prints));
    for (const [name, path, init] of [
      ["GET /api/chat/id", `/api/chat/${conv.id}`, {}],
      ["GET /api/health", "/api/health", {}],
      ["POST /api/chat/없는id", "/api/chat/nonexistent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "안녕" }) }],
    ] as [string, string, RequestInit][]) {
      const r = await http(path, init);
      scans.push(scanResponse(`${name} [${r.status}]`, await r.text(), prints));
    }

    // 4) 대조군: 내려가야 하는 값이 실제로 보이는지(로그인·페이지가 비어 있어 통과하는 일을 막는다)
    const has = (name: string, s: string) => normalizeForScan(raw[name] ?? "").includes(normalizeForScan(s));
    const controls: [string, boolean][] = [
      ["/ 에 이름", has("GET / (HTML)", target.name)],
      ["/ 에 소개(tagline)", has("GET / (HTML)", target.tagline.slice(0, 12))],
      ["/chat 에 이름", has("GET /chat/id (HTML)", target.name)],
      ["/chat 에 인사말(greeting)", has("GET /chat/id (HTML)", target.greeting.slice(0, 12))],
      ["RSC payload(/)가 비어 있지 않음(이름 포함)", has("GET / (RSC)", target.name)],
      ["RSC payload(/chat)가 비어 있지 않음(인사말 포함)", has("GET /chat/id (RSC)", target.greeting.slice(0, 12))],
      ["SSE에 응답 이벤트", /event: (delta|done)/.test(sse)],
    ];

    console.log(`대상 ${BASE} · 일반 사용자 ${email} · 지문 ${prints.reduce((n, f) => n + f.prints.length, 0)}개(비공개 필드 ${prints.length}개)\n`);
    for (const s of scans) console.log(`${s.hits.length ? "✗" : "✓"} ${s.name.padEnd(40)} ${String(s.bytes).padStart(7)}B  ${s.hits.length ? "누출: " + s.hits.join(", ") : "비공개 지문 없음"}`);
    console.log("");
    for (const [n, ok] of controls) console.log(`${ok ? "✓" : "✗"} 대조: ${n}`);
    const leaks = scans.filter((s) => s.hits.length);
    const badControls = controls.filter(([, ok]) => !ok);
    if (leaks.length) fail(`비공개 필드 누출 ${leaks.length}건: ${leaks.map((s) => `${s.name} → ${s.hits.join(", ")}`).join(" / ")}`);
    if (badControls.length) fail(`대조 항목 실패(${badControls.map(([n]) => n).join(", ")}) — 페이지가 비어 있거나 로그인이 잘못돼 검사가 무의미합니다.`);
    console.log("\n✓ 누출 없음");
  } finally {
    // 이 스크립트가 만든 대화와 그 부속 기록만 지운다(테스트 DB)
    await prisma.moderationEvent.deleteMany({ where: { conversationId: conv.id } });
    await prisma.usageLog.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.delete({ where: { id: conv.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
