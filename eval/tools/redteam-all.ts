/**
 * 레드팀 일괄 실행.
 *   npm run redteam:all -- --private <표 파일> [--mutate] [--per-case 4] [--seed <시드>] [--character <이름>] [--max-turns N] [--real --yes]
 *   npm run redteam:all -- --report-only <실행 이름>      수동 판정 표본을 채운 뒤 리포트만 다시 만든다(호출 없음)
 * 순서: 표 변환 → (변형 생성) → 앱 안전 켬 실행 → --no-app-safety 실행 → 자동 판정 → 판정기 검증 표본 → 종합 리포트.
 * 실제 API는 --real --yes를 둘 다 줬을 때만 호출한다. --real이 없으면 mock으로 돈다(동작 확인용).
 * 변환된 세트·변형·응답 원문·판정 프롬프트·결과는 전부 eval/redteam/private/ 안에만 쓴다.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { estimateCost, pricing } from "@/lib/pricing";
import { effectiveEnv } from "@/lib/test-guard";
import { renderAllReport } from "../lib/all-report";
import { LlmJudge, MockJudge, SAMPLE_SIZE, agreement, autoJudge, mutationTable, parseSampleCsv, pickSample, renderSampleCsv, toJudgeRows, withheldHarmful, type AutoJudgeRecord, type Judge } from "../lib/auto-judge";
import { detectFormat, parseTable, tableToSet } from "../lib/convert";
import { renderJudgeCsv, summarizeHarm, type CaseTranscript, type RunInfo } from "../lib/judge";
import { PRIVATE_DIR, loadCharacter } from "../lib/load";
import type { CaseResult } from "../lib/metrics";
import { DEFAULT_PER_CASE, DEFAULT_SEED, mutateSet } from "../lib/mutate";
import { TOKEN_SCALE, estimatePlan } from "../lib/plan";
import type { RedteamSet } from "../lib/schema";

const RESULTS = path.join(PRIVATE_DIR, "results");
const GENERATED = path.join(PRIVATE_DIR, "generated");
const rel = (f: string) => path.relative(process.cwd(), f);

const { values: a } = parseArgs({
  options: {
    private: { type: "string" },
    mutate: { type: "boolean", default: false },
    "per-case": { type: "string" },
    seed: { type: "string" },
    character: { type: "string", default: "eval-garden" },
    "max-turns": { type: "string" },
    real: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    "report-only": { type: "string" },
  },
});

type RunFile = {
  runId: string;
  real: boolean;
  source: string;
  chatModel: string;
  classifierModel: string;
  mutate: { enabled: boolean; seed: string; perCase: number; variants: number };
  judge: { model: string | null; skipped: string | null };
};
type RunJson = { redteam: { set: RedteamSet; cases: CaseResult[] }[] };
type ResponsesJson = { run: RunInfo; cases: CaseTranscript[] };
const readJson = <T,>(f: string) => JSON.parse(readFileSync(f, "utf8")) as T;

/** 저장된 실행 결과들로 종합 리포트를 만든다(호출 없음). */
function writeReport(runId: string) {
  const base = path.join(RESULTS, runId);
  if (!existsSync(`${base}.run.json`)) throw new Error(`실행 "${runId}"를 찾을 수 없습니다(${rel(base)}.run.json 없음).`);
  const run = readJson<RunFile>(`${base}.run.json`);
  const on = readJson<RunJson>(`${base}-on.json`);
  const off = readJson<RunJson>(`${base}-off.json`);
  const meta = new Map(on.redteam.flatMap((r) => r.set.cases.map((c) => [c.id, { mutationOf: c.mutationOf, mutation: c.mutation }] as const)));
  const allCases = on.redteam.flatMap((r) => r.set.cases);

  const judged = existsSync(`${base}.autojudge.json`) ? readJson<{ records: AutoJudgeRecord[] }>(`${base}.autojudge.json`).records : null;
  const sampleFile = `${base}.manual-sample.csv`;
  const manual = judged && existsSync(sampleFile) ? parseSampleCsv(readFileSync(sampleFile, "utf8"), sampleFile) : null;
  const agree = judged && manual ? agreement(judged, manual) : null;

  const md = renderAllReport({
    runId,
    generatedKst: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
    isMock: !run.real,
    source: run.source,
    chatModel: run.chatModel,
    classifierModel: run.classifierModel,
    mutate: run.mutate,
    cases: { attack: allCases.filter((c) => c.label === "attack").length, benign: allCases.filter((c) => c.label === "benign").length },
    judgeSkipped: run.judge.skipped,
    judgeModel: run.judge.model,
    harm: judged ? summarizeHarm(toJudgeRows(judged)) : null,
    judgeStats: judged ? (["켬", "끔"] as const).map((mode) => ({ mode, withheldHarmful: withheldHarmful(judged.filter((r) => r.mode === mode)), errors: judged.filter((r) => r.mode === mode && r.error).length })) : [],
    agreement: agree,
    sampleFile: judged && existsSync(sampleFile) ? rel(sampleFile) : null,
    mutationOn: mutationTable(on.redteam.flatMap((r) => r.cases), meta),
    mutationOff: mutationTable(off.redteam.flatMap((r) => r.cases), meta),
    embedded: [
      { title: "앱 안전 켬", md: readFileSync(`${base}-on.md`, "utf8") },
      { title: "앱 안전 끔(--no-app-safety)", md: readFileSync(`${base}-off.md`, "utf8") },
    ],
  });
  writeFileSync(`${base}.report.md`, md, "utf8");
  console.log(`\n종합 리포트: ${rel(base)}.report.md`);
  if (agree?.warn) console.log(`⚠ 판정기 검증 미달: 일치율 ${((agree.agree.value ?? 0) * 100).toFixed(1)}% (${agree.agree.k}/${agree.agree.n}) — 리포트 상단에 경고를 넣었습니다.`);
  else if (agree && agree.filled === 0) console.log(`수동 판정 표본(${rel(sampleFile)})의 '판정' 칸을 채운 뒤 --report-only ${runId} 로 리포트를 다시 만들면 일치율이 표시됩니다.`);
  else if (agree) console.log(`판정기 일치율 ${((agree.agree.value ?? 0) * 100).toFixed(1)}% (${agree.agree.k}/${agree.agree.n})`);
}

async function main() {
  if (a["report-only"]) return writeReport(a["report-only"]);
  if (!a.private) throw new Error("사용법: npm run redteam:all -- --private <표 파일> [--mutate] [--per-case 4] [--seed <시드>] [--real --yes]\n       npm run redteam:all -- --report-only <실행 이름>");
  if (a.yes && !a.real) console.log("※ --yes만 있고 --real이 없어 mock으로 실행합니다(실제 호출 없음).");

  // ── 1. 표 변환 (+ 변형) ──
  const input = path.resolve(a.private);
  const text = readFileSync(input, "utf8");
  const stem = path.basename(input).replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_");
  const { set, warnings } = tableToSet(parseTable(text, detectFormat(text, input)), { id: stem, description: "표에서 변환한 비공개 레드팀 세트. 공격 대화 원문이 들어 있으므로 저장소에 올리지 않는다." });
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  mkdirSync(GENERATED, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  const setFile = path.join(GENERATED, `${stem}.json`);
  writeFileSync(setFile, JSON.stringify(set, null, 2) + "\n", "utf8");
  const files = [setFile];

  const seed = a.seed ?? DEFAULT_SEED;
  const perCase = a["per-case"] ? Math.max(1, Math.floor(Number(a["per-case"]))) : DEFAULT_PER_CASE;
  if (!Number.isFinite(perCase)) throw new Error("--per-case는 1 이상의 정수여야 합니다.");
  const mutated = a.mutate ? mutateSet(set, { seed, perCase }) : null;
  if (mutated) {
    const f = path.join(GENERATED, `${stem}.mutated.json`);
    writeFileSync(f, JSON.stringify(mutated, null, 2) + "\n", "utf8");
    files.push(f);
  }
  const sets = mutated ? [set, mutated] : [set];
  const cases = sets.flatMap((s) => s.cases);
  const attackN = cases.filter((c) => c.label === "attack").length;
  console.log(`변환: ${set.cases.length}케이스 → ${rel(setFile)}${a.mutate ? (mutated ? ` · 변형 ${mutated.cases.length}개(시드 ${seed}, 원본당 최대 ${perCase}개) → ${rel(files[1])}` : " · 변형할 공격 케이스가 없습니다") : ""}`);

  // ── 2. 모드·판정 모델 ──
  const env = a.real ? effectiveEnv() : { ...process.env, LLM_PROVIDER: "mock", LLM_API_KEY: "" };
  const llm = getLlm(env);
  if (a.real && llm.adapter.name === "mock") throw new Error("--real인데 쓸 수 있는 API 키가 없습니다(.env의 LLM_API_KEY, 또는 테스트 환경이면 ALLOW_REAL_LLM=1).");
  const judgeModel = process.env.JUDGE_MODEL?.trim() || null;
  const judgeSkipped = !judgeModel
    ? "JUDGE_MODEL이 지정되지 않았습니다."
    : a.real && judgeModel === llm.lightModel
      ? `JUDGE_MODEL(${judgeModel})이 분류기 모델과 같습니다. 분류기와 다른 모델을 지정해야 합니다.`
      : null;
  const judge: Judge | null = judgeSkipped ? null : a.real ? new LlmJudge(llm.adapter, judgeModel!) : new MockJudge();

  // ── 3. 전체 예상 호출 수·비용 ──
  const app = loadConfig();
  const maxTurns = a["max-turns"] ? Math.max(1, Math.floor(Number(a["max-turns"]))) : undefined;
  const convs = cases.map((c) => (maxTurns ? c.turns.slice(0, maxTurns) : c.turns));
  const planBase = { convs, fixedChars: renderFixedBlock(loadCharacter(a.character!)).length, generate: true, maxOutputTokens: app.maxOutputTokens, promptTokenBudget: app.promptTokenBudget, chatModel: llm.chatModel, lightModel: llm.lightModel, table: pricing };
  const on = estimatePlan({ ...planBase, appSafety: true });
  const off = estimatePlan({ ...planBase, appSafety: false });
  // 판정: 공격 케이스당 켬·끔 1회씩. 입력 = 기준 프롬프트(약 450토큰) + 대화의 사용자 발화 + 응답(약 200토큰), 출력 약 80토큰
  const judgeCalls = judge ? attackN * 2 : 0;
  const judgeIn = judge ? 2 * cases.filter((c) => c.label === "attack").reduce((n, c) => n + 450 + 200 + Math.ceil(c.turns.join("").length * TOKEN_SCALE), 0) : 0;
  const judgeOut = judgeCalls * 80;
  const jc = judge && a.real ? estimateCost(judgeModel!, { inputTokens: judgeIn, cachedInputTokens: 0, outputTokens: judgeOut }, pricing) : null;
  const judgeCost = !judge ? 0 : jc && jc.priced && jc.cost > 0 ? jc.cost : null;
  const total = on.cost === null || off.cost === null || judgeCost === null ? null : on.cost + off.cost + judgeCost;
  const usd = (v: number | null) => (v === null ? "계산 불가(단가표에 없거나 0)" : `약 $${v.toFixed(4)}`);
  console.log(`\n모드: ${a.real ? "실제 API" : "mock(실제 호출 없음)"} · 대화 ${llm.chatModel} · 분류기 ${llm.lightModel} · 판정 ${judge ? judge.model : "건너뜀"}`);
  console.log(`케이스 ${cases.length}개(공격 ${attackN} · 정상 ${cases.length - attackN}), ${on.turns}턴`);
  console.log(`  앱 안전 켬 : 호출 약 ${on.calls}회(대화 ${on.chatCalls} + 분류기 ${on.classifierCalls}) · ${usd(on.cost)}`);
  console.log(`  앱 안전 끔 : 호출 약 ${off.calls}회(대화만) · ${usd(off.cost)}`);
  console.log(`  자동 판정  : ${judge ? `호출 ${judgeCalls}회 · ${usd(judgeCost)}` : `건너뜀 — ${judgeSkipped}`}`);
  console.log(`  합계(대략, 요약·재시도 호출 제외): 호출 약 ${on.calls + off.calls + judgeCalls}회 · 입력 약 ${Math.round((on.inputTokens + off.inputTokens + judgeIn) / 1000)}K토큰 · 출력 약 ${Math.round((on.outputTokens + off.outputTokens + judgeOut) / 1000)}K토큰 · 비용 ${usd(total)}`);
  if (judgeSkipped) console.log(`⚠ 자동 판정을 건너뜁니다: ${judgeSkipped}`);
  if (a.real && !a.yes) {
    console.error("\n실제 API를 호출하므로 비용이 발생합니다. 위 예상을 확인했다면 --yes를 붙여 다시 실행하세요. 아무것도 호출하지 않았습니다.");
    process.exit(2);
  }

  // ── 4. 켬 / 끔 실행 ──
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const stemBase = `${date}${a.real ? "" : "-mock"}-${stem}`;
  let runId = stemBase;
  for (let i = 2; ["-on.md", "-off.md", ".run.json", ".report.md"].some((s) => existsSync(path.join(RESULTS, runId + s))); i++) runId = `${stemBase}-${i}`;
  const base = path.join(RESULTS, runId);
  const childEnv = { ...process.env, ...(a.real ? {} : { LLM_PROVIDER: "mock", LLM_API_KEY: "" }) };
  const runChild = (label: string, extra: string[]) => {
    console.log(`\n━━ ${label} ━━`);
    const args = [path.resolve("node_modules/tsx/dist/cli.mjs"), "eval/run.ts", "redteam", ...files.flatMap((f) => ["--redteam-file", f]), "--character", a.character!, ...(maxTurns ? ["--max-turns", String(maxTurns)] : []), ...(a.real ? ["--yes"] : []), ...extra];
    const r = spawnSync(process.execPath, args, { stdio: "inherit", env: childEnv });
    if (r.status !== 0) throw new Error(`${label} 실행이 실패했습니다(종료 코드 ${r.status ?? "신호"}). 여기서 멈춥니다.`);
  };
  runChild("앱 안전 켬", ["--stem", `${runId}-on`]);
  runChild("앱 안전 끔(--no-app-safety)", ["--no-app-safety", "--stem", `${runId}-off`]);

  const runFile: RunFile = {
    runId,
    real: a.real,
    source: path.basename(input),
    chatModel: llm.chatModel,
    classifierModel: llm.lightModel,
    mutate: { enabled: a.mutate, seed, perCase, variants: mutated?.cases.length ?? 0 },
    judge: { model: judge?.model ?? null, skipped: judgeSkipped },
  };
  writeFileSync(`${base}.run.json`, JSON.stringify(runFile, null, 2), "utf8");

  // ── 5. 자동 판정 + 검증 표본 ──
  if (judge) {
    console.log(`\n━━ 자동 판정 (${judge.model}) ━━`);
    const resp = { 켬: readJson<ResponsesJson>(`${base}-on.responses.json`), 끔: readJson<ResponsesJson>(`${base}-off.responses.json`) };
    const records: AutoJudgeRecord[] = [];
    for (const mode of ["켬", "끔"] as const) {
      process.stdout.write(`  ${mode} `);
      records.push(...(await autoJudge(resp[mode].run, resp[mode].cases, judge, (r) => process.stdout.write(r.error ? "x" : !r.target ? "-" : r.verdict === "유해 도달" ? "!" : "."))));
      process.stdout.write("\n");
    }
    writeFileSync(`${base}.autojudge.json`, JSON.stringify({ judgeModel: judge.model, records }, null, 2), "utf8");
    writeFileSync(`${base}.autojudge.csv`, renderJudgeCsv(toJudgeRows(records)), "utf8");
    const sample = pickSample(records, { 켬: resp.켬.cases, 끔: resp.끔.cases }, seed);
    writeFileSync(`${base}.manual-sample.csv`, renderSampleCsv(sample), "utf8");
    console.log(`판정 프롬프트·결과(비공개): ${rel(base)}.autojudge.json / .csv`);
    console.log(`판정기 검증 표본 ${sample.length}건(목표 ${SAMPLE_SIZE}): ${rel(base)}.manual-sample.csv`);
  }

  // ── 6. 종합 리포트 ──
  writeReport(runId);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
