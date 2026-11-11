/**
 * 평가 실행기 (SPEC 7장).
 *   npm run eval:scenarios   정상 시나리오: 요약 전후 토큰·캐시·지연·비용
 *   npm run eval:redteam     공격/정상 대화 세트: 차단율·오탐률·단계 분포
 *   npm run eval             둘 다
 * 옵션은 eval/README.md 참고. 결과는 eval/results/<날짜>.md (+ .json).
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { effectiveEnv, isTestEnv } from "@/lib/test-guard";
import { pricing } from "@/lib/pricing";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { estimateTokens } from "@/lib/tokens";
import { getClassifier } from "@/lib/safety";
import { runConversation, type EngineConfig, type EngineDeps } from "./lib/engine";
import { EVAL_DIR, PRIVATE_DIR, loadCharacter, loadRedteamSetsTagged, loadScenarios } from "./lib/load";
import { estimatePlan } from "./lib/plan";
import { lintSummary } from "./lib/summary-lint";
import { buildJudgeRows, buildTranscript, renderJudgeCsv, renderResponsesMd, renderSummariesMd, type CaseTranscript } from "./lib/judge";
import { classifyCase, compareRuns, summarizeRedteam, summarizeRun } from "./lib/metrics";
import { renderReport, type RedteamReport, type ReportMeta, type ScenarioReport } from "./lib/report";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: "string" },
    modes: { type: "string", default: "baseline,summary" },
    "max-turns": { type: "string" },
    "input-only": { type: "boolean", default: false },
    "redteam-file": { type: "string" },
    character: { type: "string", default: "eval-garden" },
    private: { type: "boolean", default: false },
    "no-app-safety": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const what = positionals[0] ?? "all";
if (!["scenarios", "redteam", "all"].includes(what)) {
  console.error('사용법: tsx eval/run.ts [scenarios|redteam|all] [--scenario id] [--modes baseline,summary] [--max-turns N] [--input-only] [--redteam-file path] [--private] [--no-app-safety] [--yes]');
  process.exit(1);
}
const modes = args.modes!.split(",").map((m) => m.trim()).filter(Boolean);
if (modes.some((m) => m !== "baseline" && m !== "summary")) throw new Error('--modes는 baseline, summary만 가능합니다.');
const maxTurns = args["max-turns"] ? Math.max(1, Math.floor(Number(args["max-turns"]))) : undefined;

// APP_ENV=test이면 ALLOW_REAL_LLM=1 없이는 실제 호출이 막혀 mock으로 돈다
const llm = getLlm(effectiveEnv());
const isMock = llm.adapter.name === "mock";
const classifier = getClassifier(effectiveEnv());
const deps: EngineDeps = { adapter: llm.adapter, chatModel: llm.chatModel, lightModel: llm.lightModel, classifier };

const app = loadConfig();
const baseCfg: EngineConfig = {
  recentTurns: app.recentTurns,
  summaryEvery: app.summaryEvery,
  summaryEnabled: true,
  promptTokenBudget: app.promptTokenBudget,
  lorebookTokenBudget: app.lorebookTokenBudget,
  lorebookScanTurns: app.lorebookScanTurns,
  maxOutputTokens: app.maxOutputTokens,
  classifierThreshold: app.classifierBlockThreshold,
  flow: app.flow,
  generate: !args["input-only"],
  appSafety: !args["no-app-safety"],
};
if (!baseCfg.appSafety && !baseCfg.generate) {
  console.error("--no-app-safety는 모델 응답을 보는 실험이라 --input-only와 함께 쓸 수 없습니다(입력 검사가 꺼지면 호출할 것이 없습니다).");
  process.exit(1);
}
if (!baseCfg.appSafety && what === "scenarios") console.log("※ --no-app-safety는 레드팀 실행에서만 의미가 있습니다. 정상 시나리오에서는 안전 층이 꺼진 채 측정됩니다.");

const scenarios = what === "redteam" ? [] : loadScenarios(args.scenario);
const loadedSets = what === "scenarios" ? [] : loadRedteamSetsTagged(args["redteam-file"], args.private);
const redteamSets = loadedSets.map((x) => x.set);
// 케이스별 요약 설정 덮어쓰기는 테스트 환경(APP_ENV=test)에서만 쓴다. 운영과 같은 설정으로 잰 결과와 섞이지 않게 막는다.
const overridden = loadedSets.flatMap(({ set }) => set.cases.filter((c) => c.summaryEvery !== undefined || c.recentTurns !== undefined).map((c) => `${set.id}/${c.id}`));
if (overridden.length && !isTestEnv()) {
  console.error(`케이스에 summaryEvery/recentTurns가 지정돼 있지만 테스트 환경이 아닙니다(APP_ENV=test 필요): ${overridden.slice(0, 5).join(", ")}${overridden.length > 5 ? ` 외 ${overridden.length - 5}건` : ""}\n테스트 환경에서 실행하거나(scripts/test-run.ts 경유) 케이스의 해당 열을 지우세요. 아무것도 호출하지 않고 종료합니다.`);
  process.exit(1);
}
const hasPrivate = loadedSets.some((x) => x.isPrivate);
const cut = <T,>(xs: readonly T[]) => (maxTurns ? xs.slice(0, maxTurns) : xs);

// ── 실행 계획과 비용 확인 ────────────────────────────────────────────────────
const scenarioTurns = scenarios.reduce((n, s) => n + cut(s.turns).length, 0) * modes.length;
const redteamTurns = redteamSets.reduce((n, s) => n + s.cases.reduce((m, c) => m + cut(c.turns).length, 0), 0);
const perTurnCalls = baseCfg.generate ? (baseCfg.appSafety ? 3 : 1) : 1;
const plannedCalls = (scenarioTurns + redteamTurns) * perTurnCalls;
const planInput = {
  generate: baseCfg.generate,
  appSafety: baseCfg.appSafety !== false,
  maxOutputTokens: baseCfg.maxOutputTokens,
  promptTokenBudget: baseCfg.promptTokenBudget,
  chatModel: llm.chatModel,
  lightModel: llm.lightModel,
  table: pricing,
};
const redteamChar = what === "scenarios" || redteamSets.length === 0 ? null : loadCharacter(args.character!);
const plan = estimatePlan({ ...planInput, fixedChars: redteamChar ? renderFixedBlock(redteamChar).length : 0, convs: redteamSets.flatMap((s) => s.cases.map((c) => cut(c.turns))) });
const scenarioPlans = scenarios.map((s) => estimatePlan({ ...planInput, fixedChars: renderFixedBlock(loadCharacter(s.character)).length, convs: Array.from({ length: modes.length }, () => cut(s.turns)) }));
const planTotal = {
  calls: plan.calls + scenarioPlans.reduce((n, p) => n + p.calls, 0),
  inputTokens: plan.inputTokens + scenarioPlans.reduce((n, p) => n + p.inputTokens, 0),
  outputTokens: plan.outputTokens + scenarioPlans.reduce((n, p) => n + p.outputTokens, 0),
  cost: plan.cost === null || scenarioPlans.some((p) => p.cost === null) ? null : plan.cost + scenarioPlans.reduce((n, p) => n + (p.cost ?? 0), 0),
};
console.log(`어댑터: ${llm.adapter.name} · 대화 ${llm.chatModel} · 분류기/요약 ${llm.lightModel}`);
console.log(`계획: 시나리오 ${scenarios.length}개(${modes.join("+")}) ${scenarioTurns}턴, 레드팀 세트 ${redteamSets.length}개 ${redteamTurns}턴${hasPrivate ? "(비공개 세트 포함)" : ""} → 최대 약 ${plannedCalls}회 LLM 호출${baseCfg.appSafety ? "" : " · 자체 안전 층 OFF(분류기 호출 없음)"}`);
console.log(
  `예상(대략, 요약 호출 제외): 호출 약 ${planTotal.calls}회 · 입력 약 ${Math.round(planTotal.inputTokens / 1000).toLocaleString("ko-KR")}K토큰 · 출력 약 ${Math.round(planTotal.outputTokens / 1000).toLocaleString("ko-KR")}K토큰 · 비용 ${
    planTotal.cost === null ? "계산 불가(모델이 단가표에 없거나 단가 0)" : `약 $${planTotal.cost.toFixed(4)}`
  }`,
);
if (!isMock && !args.yes) {
  console.error("\n실제 API를 호출하므로 비용이 발생합니다. 위 계획·예상 비용을 확인했다면 --yes를 붙여 다시 실행하세요.");
  process.exit(2);
}
if (isMock) console.log("※ API 키가 없어 mock 어댑터로 실행합니다. 결과 수치는 의미가 없습니다(동작 확인용).");
if (what !== "scenarios" && redteamSets.length === 0) {
  console.log("※ eval/redteam/에 실행할 세트가 없습니다(example.json은 형식 예시라 기본 실행에서 제외). --redteam-file eval/redteam/example.json 으로 형식을 시험할 수 있습니다.");
}

// ── 시나리오 ─────────────────────────────────────────────────────────────────
async function runScenarios(): Promise<ScenarioReport[]> {
  const reports: ScenarioReport[] = [];
  for (const s of scenarios) {
    const character = loadCharacter(s.character);
    const cfg = { ...baseCfg, ...s.config };
    const turns = cut(s.turns);
    const fixedEst = estimateTokens(renderFixedBlock(character));
    console.log(`\n▶ ${s.id} (${turns.length}턴, 고정 블록 추정 ${fixedEst}토큰)`);

    const run = async (mode: "baseline" | "summary") => {
      process.stdout.write(`  ${mode.padEnd(8)} `);
      const { results } = await runConversation(character, s.lorebook, turns, deps, { ...cfg, summaryEnabled: mode === "summary" }, (r) =>
        process.stdout.write(r.llmError ? "x" : r.interventions.length ? "!" : r.summaryUpdated ? "S" : "."),
      );
      process.stdout.write("\n");
      return summarizeRun(results);
    };
    const baseline = modes.includes("baseline") ? await run("baseline") : null;
    const withSummary = modes.includes("summary") ? await run("summary") : null;
    reports.push({
      scenario: s,
      engineConfig: { recentTurns: cfg.recentTurns, summaryEvery: cfg.summaryEvery, promptTokenBudget: cfg.promptTokenBudget, lorebookTokenBudget: cfg.lorebookTokenBudget },
      executedTurns: turns.length,
      baseline,
      withSummary,
      comparison: baseline && withSummary ? compareRuns(baseline, withSummary) : null,
    });
  }
  return reports;
}

// ── 레드팀 ───────────────────────────────────────────────────────────────────
/** 비공개 세트의 케이스별 응답 원문(수동 판정용). 공개 결과 파일에는 쓰지 않는다. */
const transcripts: CaseTranscript[] = [];

async function runRedteam(): Promise<RedteamReport[]> {
  const reports: RedteamReport[] = [];
  const character = loadCharacter(args.character!);
  for (const { set, isPrivate } of loadedSets) {
    console.log(`\n▶ 레드팀 ${set.id} (${set.cases.length}케이스)`);
    const cases = [];
    for (const c of set.cases) {
      const caseCfg = { ...baseCfg, ...(c.summaryEvery !== undefined ? { summaryEvery: c.summaryEvery } : {}), ...(c.recentTurns !== undefined ? { recentTurns: c.recentTurns } : {}) };
      const { conv, results } = await runConversation(character, [], cut(c.turns), deps, caseCfg);
      const r = classifyCase(c, results, { appSafety: baseCfg.appSafety !== false });
      if (isPrivate) {
        const summaries = conv.summaries.map((m) => ({ version: m.version, content: m.content, coversMessages: conv.messages.findIndex((x) => x.id === m.coversUntilMsg) + 1 }));
        transcripts.push(buildTranscript(set.id, c, results, summaries));
      }
      cases.push(r);
      console.log(`  ${r.outcome === "success" ? "✓" : r.outcome === "fail" ? "✗" : "?"} ${c.id} [${c.label}→${c.expect}] ${r.firstIntervention ? `${r.firstIntervention.turn}턴 ${r.firstIntervention.stage}/${r.firstIntervention.kind}` : "개입 없음"}`);
    }
    reports.push({ set, cases, summary: summarizeRedteam(cases) });
  }
  return reports;
}

function gitInfo(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() ? " (미커밋 변경 있음)" : "";
    return sha + dirty;
  } catch {
    return "알 수 없음";
  }
}

async function main() {
  const startedAt = new Date();
  const scenarioReports = await runScenarios();
  const redteamReports = await runRedteam();

  const meta: ReportMeta = {
    startedAtKst: startedAt.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
    commit: gitInfo(),
    adapter: llm.adapter.name,
    isMock,
    chatModel: llm.chatModel,
    lightModel: llm.lightModel,
    priced: pricing.models[llm.chatModel] !== undefined && pricing.models[llm.lightModel] !== undefined,
    structuredOutput: process.env.LLM_STRUCTURED_OUTPUT !== "off",
    inputOnly: !baseCfg.generate,
    appSafety: baseCfg.appSafety !== false,
    privateRedteam: hasPrivate,
    config: {
      RECENT_TURNS: app.recentTurns,
      SUMMARY_EVERY: app.summaryEvery,
      PROMPT_TOKEN_BUDGET: `${app.promptTokenBudget} (시나리오가 따로 지정하면 그 값)`,
      LOREBOOK_TOKEN_BUDGET: app.lorebookTokenBudget,
      LOREBOOK_SCAN_TURNS: app.lorebookScanTurns,
      MAX_OUTPUT_TOKENS: app.maxOutputTokens,
      CLASSIFIER_BLOCK_THRESHOLD: app.classifierBlockThreshold,
      "FLOW (창/최소/경고/중단)": `${app.flow.windowTurns}/${app.flow.minTurns}/${app.flow.warnThreshold}/${app.flow.stopStrikes}`,
      "턴 수 제한(--max-turns)": maxTurns ?? "없음",
      "자체 안전 층": baseCfg.appSafety !== false ? "ON" : "OFF(--no-app-safety)",
    },
  };
  if (scenarioReports.length + redteamReports.length === 0) {
    console.log("\n실행한 항목이 없어 결과 파일을 만들지 않습니다.");
    return;
  }

  const md = renderReport(meta, scenarioReports, redteamReports);
  // 비공개 세트가 들어간 실행의 결과는 gitignore된 private/results/에 둔다(공개 결과 폴더로 새지 않게)
  const dir = args.out ? path.resolve(args.out) : hasPrivate ? path.join(PRIVATE_DIR, "results") : path.join(EVAL_DIR, "results");
  mkdirSync(dir, { recursive: true });
  const date = startedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const stem = `${date}${isMock ? "-mock" : ""}`;
  let file = path.join(dir, `${stem}.md`);
  for (let i = 2; existsSync(file); i++) file = path.join(dir, `${stem}-${i}.md`);
  writeFileSync(file, md, "utf8");
  // 비공개 세트는 JSON에서도 공격 대화 원문(turns)을 뺀다
  const redactedRedteam = redteamReports.map((r, i) =>
    loadedSets[i]?.isPrivate ? { ...r, set: { ...r.set, cases: r.set.cases.map((c) => ({ ...c, turns: c.turns.map(() => "(비공개)") })) } } : r,
  );
  writeFileSync(file.replace(/\.md$/, ".json"), JSON.stringify({ meta, scenarios: scenarioReports, redteam: redactedRedteam }, null, 2), "utf8");
  console.log(`\n결과 저장: ${path.relative(process.cwd(), file)} (+ .json)`);

  // 비공개 세트: 응답 원문과 수동 판정용 CSV를 private/results/에만 저장한다(공개 결과에는 원문 없음)
  if (transcripts.length) {
    if (!path.resolve(dir).startsWith(PRIVATE_DIR + path.sep) && path.resolve(dir) !== PRIVATE_DIR) {
      console.log(`※ 결과 위치(${path.relative(process.cwd(), dir)})가 비공개 폴더 밖이라 응답 원문은 저장하지 않았습니다. --out을 빼면 eval/redteam/private/results/에 저장됩니다.`);
    } else {
      const stem2 = path.basename(file).replace(/\.md$/, "");
      const run = { runId: stem2, appSafety: baseCfg.appSafety !== false, adapter: llm.adapter.name, model: llm.chatModel, startedAtKst: meta.startedAtKst };
      const base = path.join(dir, stem2);
      writeFileSync(`${base}.responses.json`, JSON.stringify({ run, cases: transcripts }, null, 2), "utf8");
      writeFileSync(`${base}.responses.md`, renderResponsesMd(run, transcripts), "utf8");
      if (transcripts.some((t) => t.summaries?.length)) {
        writeFileSync(`${base}.summaries.md`, renderSummariesMd(run, transcripts), "utf8");
        console.log(`요약 본문(비공개): ${path.relative(process.cwd(), base)}.summaries.md — 요약이 생성된 케이스 ${transcripts.filter((t) => t.summaries?.length).length}건, 지시문 의심(직접형) 요약 ${transcripts.flatMap((t) => t.summaries ?? []).filter((m) => lintSummary(m.content).some((f) => !f.quoted)).length}개`);
      }
      const rows = buildJudgeRows(run, transcripts);
      writeFileSync(`${base}.judge.csv`, renderJudgeCsv(rows), "utf8");
      console.log(`응답 원문(비공개): ${path.relative(process.cwd(), base)}.responses.md / .json`);
      console.log(`수동 판정 파일: ${path.relative(process.cwd(), base)}.judge.csv — '응답 요약'·'판정'(유해 도달 / 거절·전환 / 해당 없음) 칸을 채운 뒤 npm run eval:judge -- <csv 파일들>`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
