/**
 * 레드팀 일괄 실행.
 *   npm run redteam:all -- --private <표 파일> [--mutate] [--per-case 4] [--seed <시드>] [--character <이름>] [--max-turns N] [--real --yes]
 *   npm run redteam:all -- --report-only <실행 이름>      수동 판정 표본을 채운 뒤 리포트만 다시 만든다(호출 없음)
 *   npm run redteam:all -- --private <표 파일> --rules-only [--mutate]   모델 호출 없이 규칙 층만 평가
 *   npm run redteam:all -- --private <표 파일> --benign-only [--real --yes]   정상 케이스만 실행(오탐률·분류기 지연·응답 품질)
 * 공격 케이스가 들어간 실제 실행은 REDTEAM_APPROVED=1이 있어야 시작한다(OpenRouter는 승인 없는 레드팀을 금지).
 * 순서: 표 변환 → (변형 생성) → 앱 안전 켬 실행 → --no-app-safety 실행 → 자동 판정 → 판정기 검증 표본 → 종합 리포트.
 * 실제 API는 --real --yes를 둘 다 줬을 때만 호출한다. --real이 없으면 mock으로 돈다(동작 확인용).
 * 변환된 세트·변형·응답 원문·판정 프롬프트·결과는 전부 eval/redteam/private/ 안에만 쓴다.
 */
import "dotenv/config";
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { estimateCost, pricing } from "@/lib/pricing";
import { mergeLlmEnv } from "@/lib/llm-settings";
import { effectiveEnv, isRealLlmBlocked } from "@/lib/test-guard";
import { renderAllReport } from "../lib/all-report";
import { LlmJudge, MockJudge, SAMPLE_SIZE, agreement, autoJudge, mutationTable, parseSampleCsv, pickSample, renderSampleCsv, toJudgeRows, withheldHarmful, type AutoJudgeRecord, type Judge } from "../lib/auto-judge";
import { detectFormat, parseTable, tableToSet } from "../lib/convert";
import { renderJudgeCsv, summarizeHarm, type CaseTranscript, type RunInfo } from "../lib/judge";
import { PRIVATE_DIR, loadCharacter } from "../lib/load";
import type { CaseResult } from "../lib/metrics";
import { DEFAULT_PER_CASE, DEFAULT_SEED, mutateSet } from "../lib/mutate";
import { redteamApprovalError } from "../lib/policy";
import { evalRuleSets, renderRulesReport, summarizeRules, type RuleEvaluator } from "../lib/rules-eval";
import { qualitySection, rateText, type RedteamReport, usageText } from "../lib/report";
import { evaluateRules } from "@/lib/safety/rules";
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
    "rules-only": { type: "boolean", default: false },
    "benign-only": { type: "boolean", default: false },
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

/** 지금 서비스가 쓰는 입력 규칙(HARD는 바로 차단·위기 안내, SOFT는 분류기 힌트) */
const currentRules: RuleEvaluator = (text) => evaluateRules(text, "input");

function gitInfo(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() + (execSync("git status --porcelain", { encoding: "utf8" }).trim() ? " (미커밋 변경 있음)" : "");
  } catch {
    return "알 수 없음";
  }
}

/**
 * 이 실행(과 자식 실행)이 쓸 LLM 환경.
 *  - --real이 없으면 mock을 강제한다.
 *  - --real이면 서비스와 같은 우선순위(관리자 화면에 저장된 설정 > 환경변수)로 정한다. 저장된 설정은 읽기만 하고,
 *    키는 자식 프로세스의 환경변수로만 넘긴다(출력·파일 저장 없음). 테스트 환경은 ALLOW_REAL_LLM=1이 없으면 mock으로 남는다.
 */
async function runEnv(): Promise<Record<string, string | undefined>> {
  if (!a.real) return { ...process.env, LLM_PROVIDER: "mock", LLM_API_KEY: "" };
  if (isRealLlmBlocked()) return effectiveEnv();
  const { loadLlmSettings } = await import("@/lib/settings-db");
  const { prisma } = await import("@/lib/db");
  try {
    const saved = await loadLlmSettings();
    if (saved) console.log("LLM 설정: 관리자 화면에 저장된 설정을 사용합니다(서비스와 같은 설정).");
    return mergeLlmEnv(effectiveEnv(), saved);
  } finally {
    await prisma.$disconnect();
  }
}

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
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const uniqueId = (stemBase: string, suffixes: string[]) => {
    let id = stemBase;
    for (let i = 2; suffixes.some((x) => existsSync(path.join(RESULTS, id + x))); i++) id = `${stemBase}-${i}`;
    return id;
  };

  // ── 규칙 층만 평가: 모델을 부르지 않는다 ──
  if (a["rules-only"]) {
    const runId = uniqueId(`${date}-rules-${stem}`, [".rules.md", ".rules.json"]);
    const rows = evalRuleSets(sets, currentRules);
    const rep = summarizeRules(rows);
    const meta = {
      runId,
      generatedKst: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
      source: path.basename(input),
      rulesHash: createHash("sha256").update(readFileSync(path.resolve("src/config/safety-rules.json"))).digest("hex").slice(0, 12),
      commit: gitInfo(),
      mutate: { enabled: a.mutate, seed, perCase, variants: mutated?.cases.length ?? 0 },
    };
    writeFileSync(path.join(RESULTS, `${runId}.rules.md`), renderRulesReport(rep, meta), "utf8");
    writeFileSync(path.join(RESULTS, `${runId}.rules.json`), JSON.stringify({ meta, report: rep, rows }, null, 2), "utf8");
    const t = rep.total;
    console.log(`규칙 층 평가(모델 호출 없음): 공격 ${t.attack.n}건 HARD 적중 ${rateText(t.attack.hard)} · SOFT만 ${t.attack.softOnly.k} · 놓침 ${t.attack.missed.k} / 정상 ${t.benign.n}건 오탐 ${rateText(t.benign.falsePositive)}`);
    console.log(`결과: ${rel(path.join(RESULTS, runId))}.rules.md (+ .json)`);
    return;
  }

  // ── 정상 케이스만 실행: 공격 문구를 모델에 보내지 않는다 ──
  if (a["benign-only"]) {
    if (a.mutate) console.log("※ --benign-only에서는 --mutate를 무시합니다(변형은 공격 케이스에서만 만듭니다).");
    const benign = { ...set, id: `${set.id}-benign`, description: "정상 케이스만 추린 세트", cases: set.cases.filter((c) => c.label === "benign") };
    if (benign.cases.length === 0) throw new Error("표에 정상(통과) 케이스가 없습니다.");
    const benignFile = path.join(GENERATED, `${stem}.benign.json`);
    writeFileSync(benignFile, JSON.stringify(benign, null, 2) + "\n", "utf8");
    const env = await runEnv();
    const llm = getLlm(env);
    if (a.real && llm.adapter.name === "mock") throw new Error("--real인데 쓸 수 있는 API 키가 없습니다(관리자 화면에 저장한 설정이나 .env의 LLM_API_KEY, 테스트 환경이면 ALLOW_REAL_LLM=1).");
    const app = loadConfig();
    const maxTurns = a["max-turns"] ? Math.max(1, Math.floor(Number(a["max-turns"]))) : undefined;
    const plan = estimatePlan({ convs: benign.cases.map((c) => (maxTurns ? c.turns.slice(0, maxTurns) : c.turns)), fixedChars: renderFixedBlock(loadCharacter(a.character!)).length, generate: true, appSafety: true, maxOutputTokens: app.maxOutputTokens, promptTokenBudget: app.promptTokenBudget, chatModel: llm.chatModel, lightModel: llm.lightModel, table: pricing });
    console.log(`\n모드: ${a.real ? "실제 API" : "mock(실제 호출 없음)"} · 정상 케이스만 ${benign.cases.length}개, ${plan.turns}턴 · 대화 ${llm.chatModel} · 분류기 ${llm.lightModel}`);
    console.log(`  예상(대략, 요약·재시도 제외): 호출 약 ${plan.calls}회(대화 ${plan.chatCalls} + 분류기 ${plan.classifierCalls}) · 입력 약 ${Math.round(plan.inputTokens / 1000)}K토큰 · 출력 약 ${Math.round(plan.outputTokens / 1000)}K토큰 · 비용 ${plan.cost === null ? "계산 불가(단가표에 없거나 0)" : `약 $${plan.cost.toFixed(4)}`}`);
    if (a.real && !a.yes) {
      console.error("\n실제 API를 호출하므로 비용이 발생합니다. 위 예상을 확인했다면 --yes를 붙여 다시 실행하세요. 아무것도 호출하지 않았습니다.");
      process.exit(2);
    }
    const runId = uniqueId(`${date}${a.real ? "" : "-mock"}-benign-${stem}`, ["-run.md", ".benign-report.md"]);
    const base = path.join(RESULTS, runId);
    const r = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "eval/run.ts", "redteam", "--redteam-file", benignFile, "--character", a.character!, ...(maxTurns ? ["--max-turns", String(maxTurns)] : []), ...(a.real ? ["--yes"] : []), "--stem", `${runId}-run`], {
      stdio: "inherit",
      env: env as NodeJS.ProcessEnv,
    });
    if (r.status !== 0) throw new Error(`정상 케이스 실행이 실패했습니다(종료 코드 ${r.status ?? "신호"}).`);
    const rep = readJson<{ redteam: RedteamReport[] }>(`${base}-run.json`).redteam[0];
    const s = rep.summary;
    const lat = (x: { n: number; p50: number | null; p95: number | null }) => (x.n ? `${Math.round(x.p50 ?? 0)}ms / ${Math.round(x.p95 ?? 0)}ms (${x.n}회)` : "—");
    const fp = rep.cases.filter((c) => c.outcome === "fail");
    const md = [
      `# 정상 케이스 실행 리포트 — ${runId}`,
      "",
      ...(a.real ? [] : ["> ⚠️ **mock 어댑터 실행입니다.** 응답·판정이 가짜라 수치에 의미가 없습니다(동작 확인용).", ""]),
      `생성 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })} · 입력 표 ${path.basename(input)} · 대화 모델 ${llm.chatModel} · 분류기 ${llm.lightModel} · 정상 케이스 ${benign.cases.length}개`,
      "",
      "정상(통과 기대) 케이스만 서비스와 같은 안전 파이프라인으로 실행했습니다. 공격 문구는 모델에 보내지 않았습니다.",
      "",
      "| 지표 | 값 |",
      "| --- | --- |",
      `| 오탐률(케이스) | ${rateText(s.benignFalsePositive)} |`,
      `| 오탐률(턴) | ${rateText(s.benignTurnFalsePositive)} |`,
      `| 분류기 지연 p50 / p95 (전체) | ${lat(s.classifierLatency.all)} |`,
      `| 분류기 지연 p50 / p95 (입력 검사) | ${lat(s.classifierLatency.input)} |`,
      `| 분류기 지연 p50 / p95 (출력 검사) | ${lat(s.classifierLatency.output)} |`,
      `| ERROR(검사 장애, 오탐 아님) | ${s.checkFailed} |`,
      ...(rep.usage ? [`| LLM 호출 수 / 비용 | ${usageText(rep.usage)} |`] : []),
      "",
      `**오탐 케이스(${fp.length}건)**`,
      "",
      fp.length ? ["| 케이스 | 범주 | 기법 | 첫 개입(턴·단계·종류) |", "| --- | --- | --- | --- |", ...fp.map((c) => `| ${c.id} | ${c.category} | ${c.technique ?? "—"} | ${c.firstIntervention ? `${c.firstIntervention.turn}턴 · ${c.firstIntervention.stage} · ${c.firstIntervention.kind}` : "—"} |`)].join("\n") : "없음",
      "",
      ...qualitySection([["정상 케이스 응답", rep.quality]]),
      "",
      "## 실행 상세 (기존 리포트)",
      "",
      readFileSync(`${base}-run.md`, "utf8").replace(/^(#{1,4}) /gm, "##$1 ").trim(),
    ].join("\n") + "\n";
    writeFileSync(`${base}.benign-report.md`, md, "utf8");
    console.log(`\n정상 케이스 리포트: ${rel(base)}.benign-report.md`);
    return;
  }
  const cases = sets.flatMap((s) => s.cases);
  const attackN = cases.filter((c) => c.label === "attack").length;
  console.log(`변환: ${set.cases.length}케이스 → ${rel(setFile)}${a.mutate ? (mutated ? ` · 변형 ${mutated.cases.length}개(시드 ${seed}, 원본당 최대 ${perCase}개) → ${rel(files[1])}` : " · 변형할 공격 케이스가 없습니다") : ""}`);

  // ── 2. 모드·판정 모델 ──
  const env = await runEnv();
  const llm = getLlm(env);
  if (a.real && llm.adapter.name === "mock") throw new Error("--real인데 쓸 수 있는 API 키가 없습니다(관리자 화면에 저장한 설정이나 .env의 LLM_API_KEY, 테스트 환경이면 ALLOW_REAL_LLM=1).");
  // 공격 케이스를 실제 모델에 보내는 실행은 제공사 승인이 있어야 한다
  const approvalError = redteamApprovalError({ real: a.real, attackCases: attackN });
  if (approvalError) {
    console.error(`\n${approvalError}`);
    process.exit(3);
  }
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
  const runId = uniqueId(`${date}${a.real ? "" : "-mock"}-${stem}`, ["-on.md", "-off.md", ".run.json", ".report.md"]);
  const base = path.join(RESULTS, runId);
  const childEnv = env as NodeJS.ProcessEnv;
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
