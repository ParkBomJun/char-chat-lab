/**
 * 지연·비용 비교: 같은 N턴 시나리오를 세 방식(표시 없음 / beforeInput / fixedBlock)으로 돌려 ttft·total·actualCost를 표로 낸다.
 *   - off: cache_control 없음
 *   - beforeInput: 이번 입력 직전 메시지에 표시(서비스 기본값. 턴마다 표시가 뒤로 옮겨 간다)
 *   - fixedBlock: 고정 블록 끝에 표시를 고정
 *   - stepped: 이력이 --step 토큰(기본 1500, 환산)만큼 늘 때만 표시를 옮긴다. 이 방식만 로어북을 입력 바로 앞(beforeInput)에 둔다
 *   --arms off,stepped 처럼 일부 방식만 돌릴 수 있다.
 *   npm run cache:latency                      호출 없이 계획과 예상 비용만 출력
 *   npm run cache:latency -- --real            실제 호출(비용 발생). 기본: 2라운드 × 4개 방식 × 10턴 = 80회
 * 옵션: --rounds 2 · --turns 10 · --reply-chars 700(과거 응답 길이) · --min-tokens(breakpoint 최소 길이, 기본은 서비스 규칙 3500)
 *       --min-tokens 0 이면 모든 턴에 breakpoint를 붙인다(규칙 없이 효과만 보고 싶을 때) · --gap 1(호출 사이 초) · --max-out 128
 * 설계:
 *  - 대화 기록은 매 턴 '고정된 가짜 응답'으로 채워, 세 방식의 프롬프트가 같고(표식 한 줄과 breakpoint 표시만 다름) 재현된다. 모델의 실제 응답 길이는 영향이 없다.
 *  - 실행·방식마다 고정 블록 맨 앞에 서로 다른 표식을 넣어 이전 실행·다른 방식의 캐시와 섞이지 않게 한다.
 *  - 라운드마다 방식 순서를 한 칸씩 돌려 시간대 편향을 줄인다.
 *  - 서비스와 같은 조립기·어댑터를 쓴다(cache_control 전송은 어댑터가 openrouter.ai 주소일 때만 한다).
 * 키는 출력하지 않는다. --real 없이는 어떤 경우에도 네트워크 호출을 하지 않는다.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import haru from "../prisma/seed-data/haru.json";
import { assemblePrompt, DEFAULT_CACHE_MIN_TOKENS, DEFAULT_CACHE_STEP_TOKENS, type HistoryMessage } from "../src/lib/chat/assemble";
import { estimateCost, pricing } from "../src/lib/pricing";
import { matchLorebook, type LorebookEntryData } from "../src/lib/lorebook/match";
import { mergeLlmEnv } from "../src/lib/llm-settings";
import { OpenAiCompatAdapter } from "../src/lib/llm/openai";
import { quantile } from "./stats-lib";

const { values: args } = parseArgs({
  options: {
    real: { type: "boolean", default: false },
    rounds: { type: "string", default: "2" },
    turns: { type: "string", default: "10" },
    "reply-chars": { type: "string", default: "700" },
    "min-tokens": { type: "string" },
    gap: { type: "string", default: "1" },
    "max-out": { type: "string", default: "128" },
    arms: { type: "string" },
    step: { type: "string" },
  },
});
const rounds = Math.max(1, Number(args.rounds) || 2);
const turns = Math.min(30, Math.max(1, Number(args.turns) || 10));
const replyChars = Math.max(50, Number(args["reply-chars"]) || 700);
const minTokens = args["min-tokens"] === undefined ? DEFAULT_CACHE_MIN_TOKENS : Math.max(0, Number(args["min-tokens"]) || 0);
const gapMs = Math.max(0, Number(args.gap) || 1) * 1000;
const maxOut = Math.max(16, Number(args["max-out"]) || 128);
type Arm = "off" | "beforeInput" | "fixedBlock" | "stepped";
const ALL_ARMS: Arm[] = ["off", "beforeInput", "fixedBlock", "stepped"];
const ARMS: Arm[] = (args.arms ?? ALL_ARMS.join(",")).split(",").map((x) => x.trim()).filter((x): x is Arm => (ALL_ARMS as string[]).includes(x));
if (ARMS.length === 0) throw new Error(`--arms 에는 ${ALL_ARMS.join(", ")} 중에서 지정하세요.`);
const stepTokens = Math.max(1, Number(args.step) || DEFAULT_CACHE_STEP_TOKENS);
const ARM_LABEL: Record<Arm, string> = { off: "표시 없음", beforeInput: "beforeInput", fixedBlock: "fixedBlock", stepped: "stepped" };
const calls = rounds * ARMS.length * turns;

const userLines = [
  "오늘은 날씨가 좋네요", "정원 얘기 해 줄래요?", "윤 선생님은 어떤 분이에요?", "솔바람 마을엔 뭐가 있어요?", "고양이도 있다면서요",
  "다음엔 뭘 읽어 볼까요?", "책 추천을 하나만 해 주세요", "서가에서 제일 좋아하는 자리는요?", "비 오는 날엔 뭘 하세요?", "오늘 얘기 즐거웠어요",
  "내일도 와도 될까요?", "수요일엔 뭘 하세요?", "도서관 문은 몇 시에 닫아요?", "차를 좋아하세요?", "마을 축제도 있어요?",
  "정원에 핀 꽃 이름이 궁금해요", "책갈피는 몇 살이에요?", "창가 자리가 제일 좋죠?", "조용한 음악도 틀어요?", "마지막으로 한마디 해 주세요",
];
const cannedReply = (i: number) => {
  const s = `(${i + 1}번째 응답) 볕 좋은 창가에서 천천히 이야기해 드릴게요. 서가 사이로 바람이 지나가고, 책장 넘기는 소리가 조용히 이어지고 있어요. 괜찮으시면 차 한 잔과 함께 이어서 나눠 볼까요? `;
  return s.repeat(Math.ceil(replyChars / s.length)).slice(0, replyChars);
};
const lorebook: LorebookEntryData[] = haru.lorebook.map((l) => ({ id: l.id, keywords: l.keywords, content: l.content, priority: l.priority, enabled: true }));

type Sample = { arm: Arm; round: number; turn: number; attached: boolean; ttft: number | null; total: number; cost: number | null; input: number | null; cached: number | null; cacheWrite: number | null; output: number | null; error?: string };

/** 방식·라운드·턴에 해당하는 조립 결과. 계획(오프라인 예상)과 실제 실행이 같은 함수를 쓴다. */
function build(arm: Arm, tag: string, t: number, history: HistoryMessage[]) {
  const character = { ...haru.character, persona: `(실험 ${tag})\n${haru.character.persona}` };
  const input = userLines[t % userLines.length];
  const hits = matchLorebook(lorebook, [...history, { role: "USER", content: input }], 4);
  const a = assemblePrompt(character, null, hits, history, input, {
    promptTokenBudget: 100_000,
    lorebookTokenBudget: 800,
    // stepped만 로어북을 입력 바로 앞에 둔다(걸린 항목이 바뀌어도 표시까지의 앞부분이 유지되도록). 나머지는 서비스 기본값(afterFixed)
    lorebookPosition: arm === "stepped" ? "beforeInput" : "afterFixed",
    cacheBreakpoint: arm !== "off",
    cacheBreakpointPosition: arm === "off" ? "beforeInput" : arm,
    cacheStepTokens: stepTokens,
    cacheMinTokens: minTokens,
  });
  return { a, input };
}

/**
 * 오프라인 예상(호출 없음). 가정: 실제 토큰 = 글자 수 추정 × 0.59(2026-11-12 실측 배율), 출력은 max-out 전부.
 * 과금 가정(docs/CACHE.md): 표시까지의 앞부분이 직전 턴과 같으면 읽기만, 달라졌으면(첫 턴 포함) 읽기+쓰기, 나머지는 일반 요금.
 * (fixedBlock에서 로어북이 바뀌어 다시 만드는 경우는 반영하지 않은 근사다.)
 */
function estimate(model: string) {
  const R = 0.59;
  const perArm = new Map<Arm, { cost: number; input: number }>();
  for (const arm of ARMS) {
    let cost = 0;
    let inputSum = 0;
    const history: HistoryMessage[] = [];
    let prevBp: number | null = null;
    for (let t = 0; t < turns; t++) {
      const { a, input } = build(arm, "plan", t, history);
      const total = Math.round(a.blockTokens.total * R);
      const bp = a.cacheBreakpointIndex;
      const prefix = bp === null ? 0 : Math.min(total, Math.round(a.messages.slice(0, bp + 1).reduce((n, m) => n + m.content.length, 0) * R));
      const write = bp === null ? 0 : t > 0 && bp === prevBp ? 0 : prefix;
      prevBp = bp;
      cost += estimateCost(model, { inputTokens: total, cachedInputTokens: prefix, cacheWriteTokens: write, outputTokens: maxOut }, pricing).cost;
      inputSum += total;
      history.push({ role: "USER", content: input }, { role: "ASSISTANT", content: cannedReply(t) });
    }
    perArm.set(arm, { cost: cost * rounds, input: inputSum * rounds });
  }
  return perArm;
}

const fmtUsd = (v: number | null, d = 6) => (v === null ? "—" : v.toFixed(d));

async function resolveEnv() {
  let env: Record<string, string | undefined> = process.env;
  if (!env.LLM_API_KEY?.trim()) {
    const { loadLlmSettings } = await import("../src/lib/settings-db");
    env = mergeLlmEnv(process.env, await loadLlmSettings());
  }
  return env;
}

function printPlan(model: string) {
  const est = estimate(model);
  const priced = pricing.models[model] !== undefined;
  console.log(`계획: ${rounds}라운드 × (${ARMS.map((x) => ARM_LABEL[x]).join(", ")}) × ${turns}턴 = ${calls}회 · stepped 간격 ${stepTokens}토큰(환산) · 과거 응답 길이 ${replyChars}자 · 최대 출력 ${maxOut}토큰 · breakpoint 최소 길이 ${minTokens}토큰(환산) · 호출 간격 ${gapMs / 1000}초`);
  console.log(`예상(오프라인 계산, 모델 ${model}${priced ? "" : " — 단가표에 없어 비용 0으로 나옴"}):`);
  let sum = 0;
  for (const arm of ARMS) {
    const e = est.get(arm)!;
    sum += e.cost;
    console.log(`  ${ARM_LABEL[arm].padEnd(12)} 호출 ${rounds * turns}회 · 입력 약 ${Math.round(e.input / 1000)}K토큰 · 약 $${e.cost.toFixed(4)}`);
  }
  console.log(`  합계 약 $${sum.toFixed(4)} (가정: 실제 토큰 = 글자 수 × 0.59, 출력은 최대치 ${maxOut}토큰 전부, 캐시 과금은 docs/CACHE.md의 실측대로)`);
  return sum;
}

async function main() {
  const env = await resolveEnv();
  const model = env.LLM_CHAT_MODEL?.trim();
  if (!args.real) {
    console.log("지연·비용 비교 실험입니다(실제 호출, 비용 발생). 의도했다면 --real 을 붙여 다시 실행하세요:  npm run cache:latency -- --real");
    printPlan(model || "(모델 미설정)");
    console.log("출력: 방식별 ttft·total의 p50/p95, 턴별 actualCost와 누적 비용, 턴별 cached/cacheWr(생성인지 재사용인지).");
    return;
  }
  if (process.env.APP_ENV === "test" && process.env.ALLOW_REAL_LLM !== "1") throw new Error("APP_ENV=test에서는 ALLOW_REAL_LLM=1 없이 실제 호출을 하지 않습니다.");
  const key = env.LLM_API_KEY?.trim();
  const baseUrl = env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1";
  if (!key || !model) throw new Error("LLM_API_KEY/LLM_CHAT_MODEL이 없습니다(.env 또는 관리자 화면 설정).");
  const adapter = new OpenAiCompatAdapter({ baseUrl, apiKey: key, reasoningEffort: env.LLM_REASONING_EFFORT?.trim() || undefined, timeoutMs: 60_000 });
  console.log(`대상: ${baseUrl} · 모델 ${model} · explicit cache 전송 ${adapter.supportsExplicitCache ? "가능" : "불가(주소가 openrouter.ai가 아님 → 방식 간 차이가 없다)"} · 키는 출력하지 않음`);
  printPlan(model);
  console.log(`시작 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })} KST · ${calls}회 실행합니다…\n`);

  const stamp = Date.now();
  const samples: Sample[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let round = 0; round < rounds; round++) {
    const order = ARMS.map((_, i) => ARMS[(i + round) % ARMS.length]);
    for (const arm of order) {
      const history: HistoryMessage[] = [];
      for (let t = 0; t < turns; t++) {
        const { a, input } = build(arm, `${stamp}-r${round}-${arm}`, t, history);
        const t0 = Date.now();
        let ttft: number | null = null;
        let usage: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens?: number; outputTokens: number; cost?: number } | null = null;
        let error: string | undefined;
        try {
          for await (const ev of adapter.stream({ model, messages: a.messages, maxOutputTokens: maxOut })) {
            if (ev.type === "delta" && ttft === null) ttft = Date.now() - t0;
            if (ev.type === "done") usage = ev.usage;
          }
        } catch (e) {
          error = String(e instanceof Error ? e.message : e).slice(0, 160);
        }
        samples.push({ arm, round: round + 1, turn: t + 1, attached: a.cacheBreakpointIndex !== null, ttft, total: Date.now() - t0, cost: usage?.cost ?? null, input: usage?.inputTokens ?? null, cached: usage?.cachedInputTokens ?? null, cacheWrite: usage ? (usage.cacheWriteTokens ?? 0) : null, output: usage?.outputTokens ?? null, error });
        process.stdout.write(error ? "x" : ".");
        history.push({ role: "USER", content: input }, { role: "ASSISTANT", content: cannedReply(t) });
        await sleep(gapMs);
      }
      process.stdout.write(` r${round + 1}/${arm}\n`);
    }
  }
  console.log(`끝 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })} KST`);

  const f = (v: number | null, d = 0) => (v === null ? "—" : v.toFixed(d));
  const col = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const sumOf = (xs: number[]) => xs.reduce((n, v) => n + v, 0);
  const okOf = (arm: Arm) => samples.filter((x) => x.arm === arm && !x.error);

  console.log("\n── 방식별 요약 ──");
  console.log("| 방식 | 호출 | 오류 | 표시 붙음 | ttft p50 / p95 (ms) | total p50 / p95 (ms) | 턴당 비용 p50 ($) | 비용 합계 ($) | cached / 입력 토큰 | cacheWr 합 |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const arm of ARMS) {
    const s = okOf(arm);
    const ttft = col(s.map((x) => x.ttft));
    const total = col(s.map((x) => x.total));
    const cost = col(s.map((x) => x.cost));
    console.log(`| ${ARM_LABEL[arm]} | ${s.length} | ${samples.filter((x) => x.arm === arm && x.error).length} | ${s.filter((x) => x.attached).length}/${s.length} | ${f(quantile(ttft, 0.5))} / ${f(quantile(ttft, 0.95))} | ${f(quantile(total, 0.5))} / ${f(quantile(total, 0.95))} | ${f(quantile(cost, 0.5), 6)} | ${f(sumOf(cost), 6)} | ${sumOf(col(s.map((x) => x.cached))).toLocaleString()} / ${sumOf(col(s.map((x) => x.input))).toLocaleString()} | ${sumOf(col(s.map((x) => x.cacheWrite))).toLocaleString()} |`);
  }
  console.log(`전체 비용 합계: $${f(sumOf(col(samples.map((x) => x.cost))), 6)} (${samples.filter((x) => !x.error).length}회 성공, 오류 ${samples.filter((x) => x.error).length}회)`);

  // 턴별: 라운드 평균(라운드가 2개뿐이라 중앙값과 같다). 누적은 라운드 평균의 누적.
  const meanAt = (arm: Arm, t: number, k: "ttft" | "cost" | "input" | "cached" | "cacheWrite" | "total") => {
    const xs = col(samples.filter((x) => x.arm === arm && x.turn === t && !x.error).map((x) => x[k]));
    return xs.length ? sumOf(xs) / xs.length : null;
  };
  console.log("\n── 턴별 비용(라운드 평균, $)과 누적 ──");
  console.log(`| 턴 | 입력 토큰 | ${ARMS.map((a) => `${ARM_LABEL[a]}`).join(" | ")} | ${ARMS.map((a) => `누적 ${ARM_LABEL[a]}`).join(" | ")} |`);
  console.log(`| --- | --- | ${ARMS.map(() => "---").join(" | ")} | ${ARMS.map(() => "---").join(" | ")} |`);
  const cum: Record<Arm, number> = { off: 0, beforeInput: 0, fixedBlock: 0, stepped: 0 };
  for (let t = 1; t <= turns; t++) {
    const costs = ARMS.map((a) => meanAt(a, t, "cost"));
    ARMS.forEach((a, i) => (cum[a] += costs[i] ?? 0));
    console.log(`| ${t} | ${f(meanAt("off", t, "input"))} | ${costs.map((c) => fmtUsd(c)).join(" | ")} | ${ARMS.map((a) => fmtUsd(cum[a])).join(" | ")} |`);
  }
  console.log("\n── 턴별 캐시 토큰(라운드 평균): cached / cacheWr ──");
  console.log(`| 턴 | ${ARMS.filter((a) => a !== "off").map((a) => `${ARM_LABEL[a]} cached / cacheWr`).join(" | ")} |`);
  console.log(`| --- | ${ARMS.filter((a) => a !== "off").map(() => "---").join(" | ")} |`);
  for (let t = 1; t <= turns; t++) console.log(`| ${t} | ${ARMS.filter((a) => a !== "off").map((a) => `${f(meanAt(a, t, "cached"))} / ${f(meanAt(a, t, "cacheWrite"))}`).join(" | ")} |`);
  console.log("\n── 턴별 첫 토큰 지연(라운드 평균, ms) ──");
  console.log(`| 턴 | ${ARMS.map((a) => ARM_LABEL[a]).join(" | ")} |`);
  console.log(`| --- | ${ARMS.map(() => "---").join(" | ")} |`);
  for (let t = 1; t <= turns; t++) console.log(`| ${t} | ${ARMS.map((a) => f(meanAt(a, t, "ttft"))).join(" | ")} |`);
  console.log("\n── 원자료(JSON) ──");
  console.log(JSON.stringify(samples));
  const errs = samples.filter((x) => x.error);
  if (errs.length) console.log(`\n오류 ${errs.length}건(예: ${errs[0].arm} r${errs[0].round} t${errs[0].turn}): ${errs[0].error}`);
  console.log("\n해석 주의: 표본이 작아(방식당 rounds×turns) p95는 사실상 최댓값 근처입니다. 같은 모델·시간대의 변동이 방식 간 차이보다 클 수 있으니 --rounds를 늘려 반복하세요.");
}
main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
