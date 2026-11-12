/**
 * 프롬프트 캐시 진단.
 *   npm run cache:dump                       오프라인(네트워크 호출 없음): 연속 턴의 조립 결과를 만들어 고정 블록/접두사를 바이트 단위로 비교
 *   npm run cache:probe -- --real            실제 호출 실험(비용 발생): 같은 요청 2회 연속 등으로 usage의 cached_tokens를 원문 그대로 출력
 * --real 없이는 어떤 경우에도 네트워크 호출을 하지 않는다. 키는 출력하지 않는다.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import haru from "../prisma/seed-data/haru.json";
import { assemblePrompt, renderFixedBlock, type HistoryMessage } from "../src/lib/chat/assemble";
import { matchLorebook, type LorebookEntryData } from "../src/lib/lorebook/match";
import { mergeLlmEnv } from "../src/lib/llm-settings";
import { SseParser } from "../src/lib/sse";
import { estimateTokens } from "../src/lib/tokens";
import type { ChatMessage } from "../src/lib/llm/types";
import { comparePrefix, fillerCharsForTokens, firstDiffSnippet, makeFiller, parseTargets, sha } from "./cache-probe-lib";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { real: { type: "boolean", default: false }, "session-id": { type: "string" }, gap: { type: "string", default: "3" }, only: { type: "string" }, "chars-per-token": { type: "string", default: "4" }, "e7-targets": { type: "string", default: "2500,3200,3600,4200" }, "e9-wait": { type: "string", default: "360" } },
});
const cmd = positionals[0] ?? "dump";

// ── 서비스와 같은 조립기로 연속 턴을 만든다(최대한 실제 시나리오와 같게: 로어북 키워드가 단계적으로 등장) ──
const lorebook: LorebookEntryData[] = haru.lorebook.map((l) => ({ id: l.id, keywords: l.keywords, content: l.content, priority: l.priority, enabled: true }));
const userLines = ["오늘은 날씨가 좋네요", "정원 얘기 해 줄래요?", "윤 선생님은 어떤 분이에요?", "솔바람 마을엔 뭐가 있어요?", "고양이도 있다면서요", "다음엔 뭘 읽어 볼까요?"];
// 캐릭터 응답은 길이가 비슷한 자리표시. 1턴 응답에만 '책갈피'가 들어가 있다(실제 대화에서 그랬다).
const replies = [
  "(안경을 고쳐 쓰며) 어라, 오늘은 제 인사를 먼저 가져가셨네요. 볕 좋은 창가 자리에 '책갈피'도 벌써 자리를 잡고 졸고 있답니다. 오늘은 서가 쪽을 둘러보실래요?",
  "좋아요. 도서관 뒤편 정원은 제가 아침마다 가장 먼저 들르는 곳이에요. 바람이 불 때마다 담장 쪽에서 좋은 냄새가 번져 오죠. 혹시 좋아하시는 향이 있으세요?",
  "윤 선생님은 참 따뜻하고 넉넉한 분이셨어요. 지금은 바닷가 마을에서 작은 서점을 하고 계신답니다. 혹시 안부가 궁금한 분이 계신가요?",
  "솔바람 마을은 작고 조용한 곳이에요. 언덕 아래 빵집이 있고 토요일엔 장터가 열려요. 조용한 마을과 도시 중에 어느 쪽이 좋으세요?",
  "네, 바로 저기 낮잠에 빠져 있는 녀석이에요. 조금 도도하지만 책을 조용히 읽는 사람 곁에는 슬그머니 다가가요. 혹시 고양이를 좋아하시나요?",
];

type Turn = { input: string; messages: ChatMessage[]; loreIds: string[]; blocks: ReturnType<typeof assemblePrompt>["blockTokens"] };

function buildTurns(loreMode: "production" | "afterHistory" = "production"): Turn[] {
  const history: HistoryMessage[] = [{ role: "ASSISTANT", content: haru.character.greeting }];
  const out: Turn[] = [];
  userLines.forEach((input, i) => {
    const hits = matchLorebook(lorebook, [...history, { role: "USER", content: input }], 4);
    const a = assemblePrompt(haru.character, null, hits, history, input, { promptTokenBudget: 100_000, lorebookTokenBudget: 800 });
    let messages = a.messages;
    if (loreMode === "afterHistory" && a.lorebookIds.length) {
      // 참고용 대안: 로어북 블록을 맨 앞(고정 블록 뒤)이 아니라 이번 입력 바로 앞으로 옮긴 경우
      const loreMsg = messages.find((m, k) => k > 0 && m.role === "system" && m.content.startsWith("# 참고 설정"))!;
      messages = messages.filter((m) => m !== loreMsg);
      messages.splice(messages.length - 1, 0, loreMsg);
    }
    out.push({ input, messages, loreIds: a.lorebookIds, blocks: a.blockTokens });
    history.push({ role: "USER", content: input });
    if (i < replies.length) history.push({ role: "ASSISTANT", content: replies[i] });
  });
  return out;
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "-");

function dump() {
  const fixed = renderFixedBlock(haru.character);
  console.log("══ 1) 고정 블록(시스템 프롬프트+카드) ══");
  console.log(`글자 ${fixed.length} · 추정 토큰(글자 수 기준) ${estimateTokens(fixed)} · 실측은 첫 턴 inputTokens 참고(이전 관측: 첫 턴 총 1,484토큰)`);
  console.log("턴마다 바뀌는 값 포함 여부: 렌더 함수는 카드 필드와 상수만 사용 → 같은 카드면 항상 같은 문자열");
  console.log(`같은 카드로 두 번 렌더해 바이트 비교: ${Buffer.from(renderFixedBlock(haru.character)).equals(Buffer.from(renderFixedBlock(haru.character))) ? "동일" : "다름!"}\n`);

  const turns = buildTurns("production");
  console.log("══ 2) 연속 턴 조립 결과(서비스 방식: 로어북 = 고정 블록 바로 뒤) ══");
  const fixedHashes = new Set(turns.map((t) => sha(t.messages[0].content)));
  console.log(`턴별 messages[0] 해시: ${turns.map((t) => sha(t.messages[0].content)).join(" ")} → 서로 다른 값 ${fixedHashes.size}개 ${fixedHashes.size === 1 ? "(모든 턴에서 고정 블록은 바이트 단위로 동일)" : "(!!)"}\n`);
  console.log("턴  메시지수  총글자  로어북 id");
  turns.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}  ${String(t.messages.length).padStart(6)}  ${String(t.messages.reduce((n, m) => n + m.content.length, 0)).padStart(6)}  ${t.loreIds.join(", ") || "-"}`));

  console.log("\n══ 3) 연속 두 턴의 접두사 비교 (제공사 캐시가 재사용할 수 있는 부분) ══");
  console.log("구간   공통 메시지  첫 불일치  공통글자/이전요청글자  이전 요청 전체가 접두사?");
  const rows: { r: ReturnType<typeof comparePrefix>; label: string }[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const r = comparePrefix(turns[i].messages, turns[i + 1].messages);
    rows.push({ r, label: `${i + 1}→${i + 2}` });
    console.log(`${(i + 1 + "→" + (i + 2)).padEnd(6)} ${String(r.sameMessages).padStart(8)}   ${String(r.firstDiffIndex ?? "-").padStart(8)}  ${String(r.sameChars).padStart(6)}/${String(r.totalCharsA).padEnd(6)} (${pct(r.sameChars, r.totalCharsA).padStart(4)})   ${r.aIsPrefixOfB ? "예" : "아니오"}`);
  }
  const bad = rows.find((x) => !x.r.aIsPrefixOfB);
  if (bad) {
    const i = Number(bad.label.split("→")[0]) - 1;
    const idx = bad.r.firstDiffIndex!;
    console.log(`\n── 첫 불일치 예시(${bad.label}): messages[${idx}] ──`);
    console.log(` 이전 요청: [${turns[i].messages[idx].role}] ${JSON.stringify(turns[i].messages[idx].content.slice(0, 50))}`);
    console.log(` 다음 요청: [${turns[i + 1].messages[idx].role}] ${JSON.stringify(turns[i + 1].messages[idx].content.slice(0, 50))}`);
    console.log(` 글자 단위 차이: ${firstDiffSnippet(turns[i].messages[idx].content, turns[i + 1].messages[idx].content)}`);
  }

  console.log("\n══ 4) 참고: 로어북을 이번 입력 바로 앞으로 옮기면(SPEC 2단계 실험 후보) ══");
  const alt = buildTurns("afterHistory");
  for (let i = 0; i + 1 < alt.length; i++) {
    const r = comparePrefix(alt[i].messages, alt[i + 1].messages);
    console.log(`${(i + 1 + "→" + (i + 2)).padEnd(6)} 공통 ${r.sameChars}/${r.totalCharsA}자 (${pct(r.sameChars, r.totalCharsA)}) · 이전 요청이 통째로 접두사: ${r.aIsPrefixOfB ? "예" : "아니오"}`);
  }
  console.log("\n(위 비교는 로컬 조립 결과뿐이며 네트워크 호출은 없었습니다.)");
}

// ── 실제 호출 실험 ───────────────────────────────────────────────────────────
type Probe = { label: string; ttftMs?: number | null; promptTokens: number | null; completion: number | null; cached: number | null; cacheWrite?: number | null; cost?: number | null; rawUsage: unknown; id: string | null; ms: number; note?: string };

async function callOnce(label: string, base: string, key: string, body: Record<string, unknown>, stream: boolean, extraHeaders: Record<string, string> = {}): Promise<Probe> {
  const t0 = Date.now();
  const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ ...body, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 160).replace(key, "***")}`);
  let usage: Record<string, unknown> | null = null;
  let id: string | null = null;
  let ttftMs: number | null = null; // 첫 본문(또는 추론) 글자까지. 스트리밍일 때만
  if (stream) {
    const parser = new SseParser();
    const dec = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const f of parser.feed(dec.decode(chunk, { stream: true }))) {
        if (f.data === "[DONE]") continue;
        try {
          const j = JSON.parse(f.data);
          id ??= j.id ?? null;
          const d = j.choices?.[0]?.delta;
          if (ttftMs === null && d && (d.content || d.reasoning)) ttftMs = Date.now() - t0;
          if (j.usage) usage = j.usage; // 마지막 usage 청크(원문)
        } catch {
          /* 무시 */
        }
      }
    }
  } else {
    const j = await res.json();
    id = j.id ?? null;
    usage = j.usage ?? null;
  }
  const details = (usage?.prompt_tokens_details ?? null) as { cached_tokens?: number; cache_write_tokens?: number } | null;
  return {
    cacheWrite: details?.cache_write_tokens ?? null,
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    label,
    promptTokens: (usage?.prompt_tokens as number) ?? null,
    completion: (usage?.completion_tokens as number) ?? null,
    cached: details?.cached_tokens ?? null,
    rawUsage: usage,
    id,
    ms: Date.now() - t0,
    ttftMs,
  };
}

async function probe() {
  const e9WaitSec = Math.min(3600, Math.max(1, Number(args["e9-wait"]) || 360));
  if (!args.real) {
    console.log("실제 호출 실험입니다(비용 발생). 의도했다면 --real 을 붙여 다시 실행하세요:  npm run cache:probe -- --real");
    console.log("호출 계획(--only 없이 실행하면 E1~E8 25회. E9는 대기가 길어 --only E9로 지정했을 때만 실행, 각 요청 max_tokens=64라 출력 비용은 거의 없음. --only 로 일부만 실행 가능):");
    console.log("  E1  스트리밍 동일 요청 2회 + 비스트리밍 동일 요청 2회   (입력 약 1.9K토큰 × 4)");
    console.log("  E2  session_id 동일 요청 2회                          (약 1.9K × 2)");
    console.log("  E3  접두사가 이어지는 후속 1회                         (약 2K × 1)");
    console.log("  E4  길이 테스트: 고정 블록 + 중립 더미 텍스트, 약 4,500토큰 ×2회, 약 9,000토큰 ×2회 (session_id 포함)  → 입력 약 4.5K×2 + 9K×2");
    console.log("  E5  명시적 캐시: 고정 블록 메시지에 cache_control ephemeral, 동일 요청 2회 (session_id 포함, 약 1.9K×2)");
    console.log("  E5b 같은 방식인데 4,500토큰 규모(문서상 Gemini 명시적 캐시 쓰기 최소 길이가 4096토큰이라 E5만으로는 판단이 어려움) 2회");
    console.log("  E6  앞부분 내용이 서로 다른 약 5K토큰 요청 2개를 각각 '처음' 1회씩(cache_control 포함, 2회) → 서로 다른 앞부분이 각각 캐시를 만드는지(cached = cacheWr) 확인. 재사용은 E8/E9에서 본다");
    console.log(`  E7  문턱 찾기: cache_control을 붙인 요청을 약 ${parseTargets(args["e7-targets"]!).join(", ")}토큰으로 1회씩(영문 더미 + 실행별 표식, 크기는 근사치라 표의 prompt 열 기준) → 처음 cached>0이 되는 크기가 문턱`);
    console.log("  E8  이어지는 대화: 하루 고정 블록(실제 약 4.4K토큰) + 실행별 표식으로 시작해, 이전 요청 전체 + 새 턴(가짜 응답 1개와 새 사용자 입력 1개)을 붙인 요청 4개를 순서대로(cache_control은 서비스처럼 새 입력 직전 메시지에) → 턴마다 cacheWr가 어떻게 붙는지");
    console.log(`  E9  유지 시간(TTL): 같은 요청을 ${Math.round(e9WaitSec / 60)}분(${e9WaitSec}초) 간격으로 2회 → 둘째 요청이 읽기만 내는지(유지) 쓰기를 다시 내는지(만료). 실행에 약 ${Math.ceil(e9WaitSec / 60) + 1}분 걸린다. --only E9 로만 실행`);
    console.log("  예) npm run cache:probe -- --real --only E4,E5     (E4+E5+E5b만: 8회) · --only E6 (2회) · --only E7 (4회) · --only E8 (4회) · --only E9 (2회, 대기 포함)");
    return;
  }
  if (process.env.APP_ENV === "test" && process.env.ALLOW_REAL_LLM !== "1") throw new Error("APP_ENV=test에서는 ALLOW_REAL_LLM=1 없이 실제 호출을 하지 않습니다.");

  // 설정 해석: 환경변수 > (없으면) 관리자 화면에서 저장한 설정(DB). 서비스와 같은 우선순위가 아니라 '있는 것'을 쓴다.
  let env: Record<string, string | undefined> = process.env;
  if (!env.LLM_API_KEY?.trim()) {
    const { loadLlmSettings } = await import("../src/lib/settings-db");
    env = mergeLlmEnv(process.env, await loadLlmSettings());
  }
  const key = env.LLM_API_KEY?.trim();
  const model = env.LLM_CHAT_MODEL?.trim();
  const base = env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1";
  if (!key || !model) throw new Error("LLM_API_KEY/LLM_CHAT_MODEL이 없습니다(.env 또는 관리자 화면 설정).");
  const effort = env.LLM_REASONING_EFFORT?.trim();
  console.log(`대상: ${base} · 모델 ${model} · 추론 강도 ${effort || "(보내지 않음)"} · 키는 출력하지 않음\n`);

  const turns = buildTurns("production");
  const A = turns[2].messages; // 3번째 턴(약 1.9K토큰 규모, 서비스와 같은 조립 결과)
  const B = [...A, { role: "assistant" as const, content: replies[2] }, { role: "user" as const, content: "그분이 보내신 편지 얘기도 더 해 주세요" }];
  const base0 = { model, max_tokens: 64, ...(effort ? { reasoning: { effort } } : {}) };
  const gap = Math.max(0, Number(args.gap) || 3) * 1000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const results: Probe[] = [];
  const run = async (label: string, messages: ChatMessage[], stream: boolean, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    try {
      const p = await callOnce(label, base, key, { ...base0, messages, ...extra }, stream, headers);
      results.push(p);
    } catch (e) {
      results.push({ label, promptTokens: null, completion: null, cached: null, rawUsage: null, id: null, ms: 0, note: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
    await sleep(gap);
  };

  const only = new Set((args.only ?? "E1,E2,E3,E4,E5,E6,E7,E8").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
  const want = (k: string) => only.has(k);
  const sid = args["session-id"] ?? `cache-probe-${Date.now()}`;

  if (want("E1")) {
    await run("E1-1 스트리밍 동일요청 첫번째", A, true);
    await run("E1-2 스트리밍 동일요청 두번째", A, true);
    await run("E1n-1 비스트리밍 첫번째", A, false);
    await run("E1n-2 비스트리밍 두번째", A, false);
  }
  if (want("E2")) {
    await run("E2-1 session_id 첫번째", A, true, { session_id: sid });
    await run("E2-2 session_id 두번째", A, true, { session_id: sid });
  }
  if (want("E3")) await run("E3 접두사가 이어지는 후속(A+새 턴)", B, true, { session_id: sid });

  // E4: 고정 블록 바로 뒤에 중립적인 더미 텍스트를 붙여 길이만 키운다(내용은 캐릭터·안전과 무관한 영문 일반 문장).
  // 토큰 수는 '글자 수 ÷ chars-per-token(기본 4)'으로 맞추는 근사치이므로, 실제 값은 표의 prompt 열(제공사가 센 값)을 보라.
  const cpt = Math.max(1, Number(args["chars-per-token"]) || 4);
  const FIXED_TOKENS_GUESS = 1300; // 이전 실측(첫 턴 총 1,484토큰 중 고정 블록 약 1.3K)
  const withFiller = (targetTokens: number): ChatMessage[] => {
    const need = Math.max(0, targetTokens - FIXED_TOKENS_GUESS) * cpt;
    return [A[0], { role: "system", content: `# 참고 자료(더미, 의미 없음)\n${makeFiller(need)}` }, ...A.slice(1)];
  };
  if (want("E4")) {
    for (const target of [4500, 9000]) {
      const m = withFiller(target);
      const sidL = `${sid}-len${target}`;
      await run(`E4 ${target}토큰급 첫번째`, m, true, { session_id: sidL });
      await run(`E4 ${target}토큰급 두번째`, m, true, { session_id: sidL });
    }
  }

  // E5: 명시적 캐시. OpenRouter 문서(Gemini): cache_control은 content part 배열 안에 넣어야 하고, 마지막 breakpoint만 쓰이며,
  // 첫 system 메시지에 붙이면 그 메시지까지가 캐시 대상이다. 문자열 content에 붙이는 예시는 문서에 없다.
  const withCacheControl = (msgs: ChatMessage[]): unknown[] => [
    { role: "system", content: [{ type: "text", text: msgs[0].content, cache_control: { type: "ephemeral" } }] },
    ...msgs.slice(1),
  ];
  if (want("E5")) {
    const m = withCacheControl(A);
    await run("E5 cache_control 첫번째", m as ChatMessage[], true, { session_id: `${sid}-e5` });
    await run("E5 cache_control 두번째", m as ChatMessage[], true, { session_id: `${sid}-e5` });
  }
  if (want("E5B") || want("E5")) {
    // 문서상 Gemini 명시적 캐시 쓰기 최소 길이(4096토큰)를 넘기려고, 더미를 고정 블록과 같은 system 메시지에 합쳐 breakpoint를 붙인다.
    const big = withFiller(4500);
    const merged: ChatMessage[] = [{ role: "system", content: `${big[0].content}\n\n${big[1].content}` }, ...big.slice(2)];
    const m = withCacheControl(merged);
    await run("E5b 4500토큰급+cache_control 첫번째", m as ChatMessage[], true, { session_id: `${sid}-e5b` });
    await run("E5b 4500토큰급+cache_control 두번째", m as ChatMessage[], true, { session_id: `${sid}-e5b` });
  }

  // E6: 앞부분 내용이 서로 다른 약 5K토큰 요청 2개를 '각각 처음' 보낸다(cache_control 포함). 맨 앞에 실행마다 다른 표식을 넣어 이전 실행의 캐시와도 겹치지 않게 한다.
  // 주의(2026-11-12 정정): 첫 요청의 cached = cacheWr는 "캐시를 만든 요청"이라는 뜻이다(읽기+쓰기 청구). 이 실험은 매번 다른 앞부분을 보내므로
  // 재사용(읽기만)은 관측되지 않는다. 재사용은 실제 대화와 E8/E9에서 본다.
  if (want("E6")) {
    const stamp = Date.now();
    const variants = [{ tag: "alpha", offset: 0 }, { tag: "bravo", offset: 5000 }];
    for (const v of variants) {
      const filler = makeFiller(Math.max(0, 5000 - FIXED_TOKENS_GUESS) * cpt, v.offset);
      const sys = `# 변형 ${v.tag}-${stamp}\n${filler}\n\n${A[0].content}`; // 앞부분(맨 처음 글자)부터 서로 다르다
      const m = withCacheControl([{ role: "system", content: sys }, ...A.slice(1)]);
      await run(`E6 서로 다른 앞부분 ${v.tag} (첫 요청)`, m as ChatMessage[], true, { session_id: `${sid}-e6-${v.tag}-${stamp}` });
    }
  }

  // E7: 명시적 캐시가 동작하기 시작하는 길이(문턱) 찾기. 1.75K 실패·5.8K 동작 사이를 메운다.
  // 카드 v3 이후 서비스 조립 결과(A)가 이미 3K토큰 안팎이라 작은 크기를 만들 수 없으므로, 영문 더미만으로 system 메시지를 만든다.
  // 문턱을 넘으면 캐시를 만드는 첫 요청부터 cached = cacheWr > 0이 보이므로 크기마다 1회면 된다. 맨 앞 표식이 실행·크기마다 달라 이전 요청의 캐시와 겹치지 않는다.
  const e7Rows: { target: number; label: string }[] = [];
  if (want("E7")) {
    const stamp = Date.now();
    for (const target of parseTargets(args["e7-targets"]!)) {
      const sys = `# 문턱 실험 ${target}-${stamp}\n${makeFiller(fillerCharsForTokens(target))}`;
      const m = withCacheControl([{ role: "system", content: sys }, { role: "user", content: "안녕하세요. 한 문장으로 인사해 주세요." }]);
      const label = `E7 문턱 ${target}토큰 목표 +cache_control`;
      e7Rows.push({ target, label });
      await run(label, m as ChatMessage[], true, { session_id: `${sid}-e7-${target}-${stamp}` });
    }
  }

  // 서비스와 같은 방식: 지정한 메시지 하나를 content part 배열로 바꿔 cache_control을 붙인다(Gemini는 마지막 breakpoint만 쓴다).
  const withBreakpointAt = (msgs: ChatMessage[], idx: number): unknown[] =>
    msgs.map((m, i) => (i === idx ? { role: m.role, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] } : m));
  const fixedBlock = renderFixedBlock(haru.character);
  const greeting: ChatMessage = { role: "assistant", content: haru.character.greeting };

  // E8: 같은 대화가 이어지는 상황. 요청 k = 이전 요청 전체 + (가짜 응답 1개 + 새 사용자 입력 1개). 로어북은 넣지 않는다(걸린 항목이 바뀌면 앞부분이 달라지므로).
  // 맨 앞 표식으로 이 실행만의 앞부분을 만들어, 서비스 대화나 이전 실행이 만든 캐시와 겹치지 않고 "생성"부터 시작하게 한다.
  const e8Rows: string[] = [];
  if (want("E8")) {
    const stamp = Date.now();
    const sys: ChatMessage = { role: "system", content: `# 실행 표식 e8-${stamp}\n${fixedBlock}` };
    const convo: ChatMessage[] = [sys, greeting];
    for (let k = 0; k < 4; k++) {
      if (k > 0) convo.push({ role: "assistant", content: replies[k - 1] });
      convo.push({ role: "user", content: userLines[k] });
      const label = `E8 이어지는 대화 ${k + 1}턴째`;
      e8Rows.push(label);
      // 표시는 새 사용자 입력 바로 앞 메시지(첫 턴은 인사말, 이후는 직전 가짜 응답)에 붙인다
      await run(label, withBreakpointAt([...convo], convo.length - 2) as ChatMessage[], true, { session_id: `${sid}-e8-${stamp}` });
    }
  }

  // E9: 유지 시간(TTL). 같은 요청을 간격을 두고 2회. 문서상 5분이므로 기본 6분 뒤에는 만료돼 쓰기가 다시 붙을 것으로 예상한다.
  const e9Rows: string[] = [];
  if (want("E9")) {
    const stamp = Date.now();
    const m = withBreakpointAt([{ role: "system", content: `# 실행 표식 e9-${stamp}\n${fixedBlock}` }, greeting, { role: "user", content: userLines[0] }], 1) as ChatMessage[];
    const extra = { session_id: `${sid}-e9-${stamp}` };
    e9Rows.push("E9 유지 시간 첫번째", `E9 유지 시간 두번째(${e9WaitSec}초 뒤)`);
    await run(e9Rows[0], m, true, extra);
    console.log(`E9: 첫 요청을 보냈습니다. ${e9WaitSec}초(약 ${Math.round(e9WaitSec / 60)}분) 기다린 뒤 같은 요청을 한 번 더 보냅니다. 끝날 때까지 창을 닫지 마세요.`);
    for (let left = e9WaitSec - Math.round(gap / 1000); left > 0; left -= 60) {
      await sleep(Math.min(60, left) * 1000);
      if (left > 60) console.log(`  … 남은 대기 약 ${Math.ceil((left - 60) / 60)}분`);
    }
    await run(e9Rows[1], m, true, extra);
  }

  console.log("실험                                    prompt  cached  cacheWr  cost($)      completion   ms   id");
  for (const r of results) console.log(`${r.label.padEnd(40)} ${String(r.promptTokens ?? "-").padStart(6)} ${String(r.cached ?? "(없음)").padStart(7)} ${String(r.cacheWrite ?? "-").padStart(8)}  ${String(r.cost ?? "-").padEnd(11)} ${String(r.completion ?? "-").padStart(10)} ${String(r.ms).padStart(5)}  ${r.id ?? "-"}${r.note ? "  ⚠ " + r.note : ""}`);
  if (e7Rows.length) {
    console.log("\n── E7 문턱 표(크기순, prompt는 제공사가 센 실제 토큰) ──");
    console.log("| 목표 | prompt | cached | cacheWr | cost($) | ms |");
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const e of e7Rows) {
      const r = results.find((x) => x.label === e.label)!;
      console.log(`| ${e.target} | ${r.promptTokens ?? "-"} | ${r.cached ?? "-"} | ${r.cacheWrite ?? "-"} | ${r.cost ?? "-"} | ${r.ms} |${r.note ? ` ⚠ ${r.note}` : ""}`);
    }
  }
  const turnTable = (title: string, labels: string[]) => {
    console.log(`\n── ${title} ──`);
    console.log("| 요청 | prompt | 늘어난 입력 | cached | cacheWr | cost($) | ttft(ms) | ms |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
    let prev: number | null = null;
    for (const l of labels) {
      const r = results.find((x) => x.label === l)!;
      const grew = prev !== null && r.promptTokens !== null ? String(r.promptTokens - prev) : "-";
      console.log(`| ${l} | ${r.promptTokens ?? "-"} | ${grew} | ${r.cached ?? "-"} | ${r.cacheWrite ?? "-"} | ${r.cost ?? "-"} | ${r.ttftMs ?? "-"} | ${r.ms} |${r.note ? ` ⚠ ${r.note}` : ""}`);
      if (r.promptTokens !== null) prev = r.promptTokens;
    }
  };
  if (e8Rows.length) turnTable("E8 이어지는 대화(prompt는 제공사가 센 실제 토큰)", e8Rows);
  if (e9Rows.length) turnTable(`E9 유지 시간(간격 ${e9WaitSec}초)`, e9Rows);
  console.log("\n── usage 원문(마지막 청크/응답) ──");
  for (const r of results) console.log(`${r.label}: ${JSON.stringify(r.rawUsage)}`);
  console.log("\n해석 가이드: E1-2의 cached가 0보다 크면 이 모델은 캐시를 지원하고 우리 쪽 보고도 정상. E1-2가 0이고 E2-2(session_id)만 크면 라우팅 문제(session_id 필요).");
  console.log("E1/E2 모두 0이고 E1n(비스트리밍)만 크면 스트리밍 usage에 cached가 빠지는 것. 모두 0이면 모델 최소 길이 미달 또는 해당 모델/엔드포인트가 암시적 캐시 미지원.");
  console.log("E4: 4,500토큰급 두번째에서 cached가 생기고 1.9K급(E1/E2)에서만 0이면 최소 길이 문제. 9,000토큰급에서만 생기면 최소 길이가 더 크다. 전부 0이면 길이 때문이 아니다.");
  console.log("E6: alpha·bravo 둘 다 첫 요청에서 cached = cacheWr > 0이면 '캐시를 만든 요청'이다(그 토큰에 읽기+쓰기 단가). 앞부분이 매번 달라 재사용은 이 실험에서 볼 수 없다. 2026-11-12 실제 대화에서 같은 앞부분의 둘째 요청은 cached > 0, cacheWr = 0(읽기만)이었다.");
  console.log("E5/E5b: 두번째 요청에서 cached>0 이거나 첫번째에서 cacheWr>0 이면 명시적 캐시가 동작. 에러(HTTP 4xx)나 둘 다 0이면 이 모델/경로에서 cache_control이 무시되거나 최소 길이 미달(note/원문 usage 확인). cost 열은 제공사가 청구한 실제 금액이라 캐시 쓰기/읽기 단가 확인에도 쓴다.");
  console.log("E8 이어지는 대화: 1턴째는 생성(cached = cacheWr ≈ 앞부분 전체)일 것이다. 2턴째부터 cacheWr를 본다 — (가) cacheWr가 매번 앞부분 전체만큼 다시 붙으면 턴마다 읽기+쓰기를 전부 다시 내는 것, (나) '늘어난 입력' 정도만 붙으면 늘어난 부분만 새로 쓰는 것, (다) 0이면 이전 캐시를 읽기만 하고 새로 쓰지 않는 것(이 경우 cached가 이전 턴의 표시 위치까지만 잡히는지도 본다). cost를 검산식(비캐시×0.75 + cached×0.075 + cacheWr×0.041667 + 출력×3.75)과 맞춰 본다.");
  console.log("E9 유지 시간: 둘째 요청이 cached > 0, cacheWr = 0이면 그 간격에도 캐시가 유지된 것, cacheWr > 0이면 만료돼 다시 만든 것(문서상 5분). cached = 0이면 캐시가 전혀 쓰이지 않은 것이므로 usage 원문을 확인한다.");
  console.log("E7 문턱: 크기순으로 처음 cached>0이 되는 요청의 prompt 값이 문턱의 상한, 바로 아래 크기(cached=0)의 prompt 값이 하한이다(처음 cached>0이 되는 크기가 문턱). 전부 0이면 문턱은 가장 큰 크기보다 위(5.8K 이하), 전부 >0이면 가장 작은 크기보다 아래다. 간격을 좁히려면 --e7-targets 로 다시 잰다. 실패(⚠)한 행은 판정에서 뺀다.");
}

(cmd === "dump" ? Promise.resolve(dump()) : probe()).catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
