/**
 * 지연·비용 비교: 같은 N턴 시나리오를 cache breakpoint 끔/켬으로 돌려 ttft·total·actualCost의 p50/p95를 표로 낸다.
 *   npm run cache:latency                      호출 없이 계획만 출력
 *   npm run cache:latency -- --real            실제 호출(비용 발생). 기본: 2라운드 × 2개 방식 × 10턴 = 40회
 * 옵션: --rounds 2 · --turns 10 · --reply-chars 700(과거 응답 길이) · --min-tokens(breakpoint 최소 길이, 기본은 서비스 규칙 4096)
 *       --min-tokens 0 이면 모든 턴에 breakpoint를 붙인다(규칙 없이 효과만 보고 싶을 때) · --gap 1(호출 사이 초) · --max-out 128
 * 설계:
 *  - 대화 기록은 매 턴 '고정된 가짜 응답'으로 채워, 두 방식의 프롬프트가 바이트 단위로 같고(breakpoint 표시만 다름) 재현된다. 모델의 실제 응답 길이는 영향이 없다.
 *  - 실행·방식마다 고정 블록 맨 앞에 서로 다른 표식을 넣어 이전 실행·다른 방식의 캐시와 섞이지 않게 한다.
 *  - 라운드마다 방식 순서를 번갈아(끔→켬, 켬→끔) 시간대 편향을 줄인다.
 *  - 서비스와 같은 조립기·어댑터를 쓴다(cache_control 전송은 어댑터가 openrouter.ai 주소일 때만 한다).
 * 키는 출력하지 않는다. --real 없이는 어떤 경우에도 네트워크 호출을 하지 않는다.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import haru from "../prisma/seed-data/haru.json";
import { assemblePrompt, DEFAULT_CACHE_MIN_TOKENS, type HistoryMessage } from "../src/lib/chat/assemble";
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
  },
});
const rounds = Math.max(1, Number(args.rounds) || 2);
const turns = Math.min(30, Math.max(1, Number(args.turns) || 10));
const replyChars = Math.max(50, Number(args["reply-chars"]) || 700);
const minTokens = args["min-tokens"] === undefined ? DEFAULT_CACHE_MIN_TOKENS : Math.max(0, Number(args["min-tokens"]) || 0);
const gapMs = Math.max(0, Number(args.gap) || 1) * 1000;
const maxOut = Math.max(16, Number(args["max-out"]) || 128);
const calls = rounds * 2 * turns;

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

type Sample = { arm: "off" | "on"; round: number; turn: number; attached: boolean; ttft: number | null; total: number; cost: number | null; input: number | null; cached: number | null; error?: string };

if (!args.real) {
  console.log("지연·비용 비교 실험입니다(실제 호출, 비용 발생). 의도했다면 --real 을 붙여 다시 실행하세요:  npm run cache:latency -- --real");
  console.log(`계획: ${rounds}라운드 × (끔, 켬) × ${turns}턴 = ${calls}회 · 과거 응답 길이 ${replyChars}자 · 최대 출력 ${maxOut}토큰 · breakpoint 최소 길이 ${minTokens}토큰(환산) · 호출 간격 ${gapMs / 1000}초`);
  console.log("출력: 방식별 ttft·total·actualCost의 p50/p95, 실제 breakpoint가 붙은 호출 수, 캐시 토큰 비중, 비용 합계.");
  console.log("참고: 서비스 규칙(최소 길이 미만이면 생략)을 그대로 쓰면 짧은 대화 초반 턴에는 breakpoint가 붙지 않습니다. 붙은 호출 수가 표에 같이 나옵니다. 규칙 없이 보려면 --min-tokens 0");
  const estChars = rounds * 2 * Array.from({ length: turns }, (_, t) => 2400 + t * (replyChars + 30)).reduce((n, v) => n + v, 0);
  console.log(`입력 규모(대략): 합계 약 ${Math.round((estChars * 0.6) / 1000).toLocaleString()}K토큰(고정 블록 2.4K자 + 턴당 응답·질문 글자 수 × 0.6 환산). 단가표 기준 비용을 먼저 가늠하세요.`);
  process.exit(0);
}

async function main() {
  if (process.env.APP_ENV === "test" && process.env.ALLOW_REAL_LLM !== "1") throw new Error("APP_ENV=test에서는 ALLOW_REAL_LLM=1 없이 실제 호출을 하지 않습니다.");
  let env: Record<string, string | undefined> = process.env;
  if (!env.LLM_API_KEY?.trim()) {
    const { loadLlmSettings } = await import("../src/lib/settings-db");
    env = mergeLlmEnv(process.env, await loadLlmSettings());
  }
  const key = env.LLM_API_KEY?.trim();
  const model = env.LLM_CHAT_MODEL?.trim();
  const baseUrl = env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1";
  if (!key || !model) throw new Error("LLM_API_KEY/LLM_CHAT_MODEL이 없습니다(.env 또는 관리자 화면 설정).");
  const adapter = new OpenAiCompatAdapter({ baseUrl, apiKey: key, reasoningEffort: env.LLM_REASONING_EFFORT?.trim() || undefined, timeoutMs: 60_000 });
  console.log(`대상: ${baseUrl} · 모델 ${model} · explicit cache 전송 ${adapter.supportsExplicitCache ? "가능" : "불가(주소가 openrouter.ai가 아님 → 켬/끔 차이가 없다)"} · 키는 출력하지 않음`);
  console.log(`${calls}회 실행합니다…\n`);

  const stamp = Date.now();
  const samples: Sample[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let round = 0; round < rounds; round++) {
    const order: ("off" | "on")[] = round % 2 === 0 ? ["off", "on"] : ["on", "off"];
    for (const arm of order) {
      const character = { ...haru.character, persona: `(실험 ${stamp}-r${round}-${arm})\n${haru.character.persona}` };
      const history: HistoryMessage[] = [];
      for (let t = 0; t < turns; t++) {
        const input = userLines[t % userLines.length];
        const hits = matchLorebook(lorebook, [...history, { role: "USER", content: input }], 4);
        const a = assemblePrompt(character, null, hits, history, input, {
          promptTokenBudget: 100_000,
          lorebookTokenBudget: 800,
          lorebookPosition: "afterFixed",
          cacheBreakpoint: arm === "on",
          cacheMinTokens: minTokens,
        });
        const t0 = Date.now();
        let ttft: number | null = null;
        let usage: { inputTokens: number; cachedInputTokens: number; cost?: number } | null = null;
        let error: string | undefined;
        try {
          for await (const ev of adapter.stream({ model, messages: a.messages, maxOutputTokens: maxOut })) {
            if (ev.type === "delta" && ttft === null) ttft = Date.now() - t0;
            if (ev.type === "done") usage = ev.usage;
          }
        } catch (e) {
          error = String(e instanceof Error ? e.message : e).slice(0, 160);
        }
        samples.push({ arm, round: round + 1, turn: t + 1, attached: a.cacheBreakpointIndex !== null, ttft, total: Date.now() - t0, cost: usage?.cost ?? null, input: usage?.inputTokens ?? null, cached: usage?.cachedInputTokens ?? null, error });
        process.stdout.write(error ? "x" : ".");
        history.push({ role: "USER", content: input }, { role: "ASSISTANT", content: cannedReply(t) });
        await sleep(gapMs);
      }
      process.stdout.write(` r${round + 1}/${arm}\n`);
    }
  }

  const f = (v: number | null, d = 0) => (v === null ? "—" : v.toFixed(d));
  const col = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  console.log("\n방식  호출  오류  breakpoint  ttft p50/p95(ms)   total p50/p95(ms)   actualCost p50/p95($)        비용합($)    캐시토큰/입력");
  for (const arm of ["off", "on"] as const) {
    const s = samples.filter((x) => x.arm === arm && !x.error);
    const err = samples.filter((x) => x.arm === arm && x.error).length;
    const ttft = col(s.map((x) => x.ttft));
    const total = col(s.map((x) => x.total));
    const cost = col(s.map((x) => x.cost));
    const input = col(s.map((x) => x.input)).reduce((n, v) => n + v, 0);
    const cached = col(s.map((x) => x.cached)).reduce((n, v) => n + v, 0);
    console.log(
      `${arm === "on" ? "켬 " : "끔 "}  ${String(s.length).padStart(4)}  ${String(err).padStart(4)}  ${String(s.filter((x) => x.attached).length).padStart(5)}/${String(s.length).padEnd(4)}  ${`${f(quantile(ttft, 0.5))} / ${f(quantile(ttft, 0.95))}`.padEnd(18)} ${`${f(quantile(total, 0.5))} / ${f(quantile(total, 0.95))}`.padEnd(19)} ${`${f(quantile(cost, 0.5), 6)} / ${f(quantile(cost, 0.95), 6)}`.padEnd(28)} ${f(cost.reduce((n, v) => n + v, 0), 6).padEnd(12)} ${cached.toLocaleString()}/${input.toLocaleString()}`,
    );
  }
  const errs = samples.filter((x) => x.error);
  if (errs.length) console.log(`\n오류 ${errs.length}건(예: ${errs[0].arm} r${errs[0].round} t${errs[0].turn}): ${errs[0].error}`);
  console.log("\n턴별(켬/끔 중앙값 비교): 턴  breakpoint(켬) · ttft 끔→켬 · cost 끔→켬");
  for (let t = 1; t <= turns; t++) {
    const pick = (arm: "off" | "on", k: "ttft" | "cost") => quantile(col(samples.filter((x) => x.arm === arm && x.turn === t && !x.error).map((x) => x[k])), 0.5);
    const att = samples.filter((x) => x.arm === "on" && x.turn === t && x.attached).length;
    console.log(`  ${String(t).padStart(2)}  ${att}/${rounds}  ·  ${f(pick("off", "ttft"))}→${f(pick("on", "ttft"))}ms  ·  ${f(pick("off", "cost"), 6)}→${f(pick("on", "cost"), 6)}`);
  }
  console.log("\n해석 주의: 표본이 작아(방식당 rounds×turns) p95는 사실상 최댓값 근처입니다. 같은 모델·시간대의 변동이 켬/끔 차이보다 클 수 있으니 --rounds를 늘려 반복하세요.");
}
main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
