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
import { pricing } from "@/lib/pricing";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { estimateTokens } from "@/lib/tokens";
import { getClassifier } from "@/lib/safety";
import { runConversation, type EngineConfig, type EngineDeps } from "./lib/engine";
import { EVAL_DIR, loadCharacter, loadRedteamSets, loadScenarios } from "./lib/load";
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
    yes: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const what = positionals[0] ?? "all";
if (!["scenarios", "redteam", "all"].includes(what)) {
  console.error('사용법: tsx eval/run.ts [scenarios|redteam|all] [--scenario id] [--modes baseline,summary] [--max-turns N] [--input-only] [--redteam-file path] [--yes]');
  process.exit(1);
}
const modes = args.modes!.split(",").map((m) => m.trim()).filter(Boolean);
if (modes.some((m) => m !== "baseline" && m !== "summary")) throw new Error('--modes는 baseline, summary만 가능합니다.');
const maxTurns = args["max-turns"] ? Math.max(1, Math.floor(Number(args["max-turns"]))) : undefined;

const llm = getLlm();
const isMock = llm.adapter.name === "mock";
const classifier = getClassifier();
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
};

const scenarios = what === "redteam" ? [] : loadScenarios(args.scenario);
const redteamSets = what === "scenarios" ? [] : loadRedteamSets(args["redteam-file"]);
const cut = <T,>(xs: readonly T[]) => (maxTurns ? xs.slice(0, maxTurns) : xs);

// ── 실행 계획과 비용 확인 ────────────────────────────────────────────────────
const scenarioTurns = scenarios.reduce((n, s) => n + cut(s.turns).length, 0) * modes.length;
const redteamTurns = redteamSets.reduce((n, s) => n + s.cases.reduce((m, c) => m + cut(c.turns).length, 0), 0);
const plannedCalls = (scenarioTurns + redteamTurns) * (baseCfg.generate ? 3 : 1);
console.log(`어댑터: ${llm.adapter.name} · 대화 ${llm.chatModel} · 분류기/요약 ${llm.lightModel}`);
console.log(`계획: 시나리오 ${scenarios.length}개(${modes.join("+")}) ${scenarioTurns}턴, 레드팀 세트 ${redteamSets.length}개 ${redteamTurns}턴 → 최대 약 ${plannedCalls}회 LLM 호출`);
if (!isMock && !args.yes) {
  console.error("\n실제 API를 호출하므로 비용이 발생합니다. 계획을 확인했다면 --yes를 붙여 다시 실행하세요.");
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
async function runRedteam(): Promise<RedteamReport[]> {
  const reports: RedteamReport[] = [];
  const character = loadCharacter(args.character!);
  for (const set of redteamSets) {
    console.log(`\n▶ 레드팀 ${set.id} (${set.cases.length}케이스)`);
    const cases = [];
    for (const c of set.cases) {
      const { results } = await runConversation(character, [], cut(c.turns), deps, baseCfg);
      const r = classifyCase(c, results);
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
    },
  };
  if (scenarioReports.length + redteamReports.length === 0) {
    console.log("\n실행한 항목이 없어 결과 파일을 만들지 않습니다.");
    return;
  }

  const md = renderReport(meta, scenarioReports, redteamReports);
  const dir = args.out ? path.resolve(args.out) : path.join(EVAL_DIR, "results");
  mkdirSync(dir, { recursive: true });
  const date = startedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const stem = `${date}${isMock ? "-mock" : ""}`;
  let file = path.join(dir, `${stem}.md`);
  for (let i = 2; existsSync(file); i++) file = path.join(dir, `${stem}-${i}.md`);
  writeFileSync(file, md, "utf8");
  writeFileSync(file.replace(/\.md$/, ".json"), JSON.stringify({ meta, scenarios: scenarioReports, redteam: redteamReports }, null, 2), "utf8");
  console.log(`\n결과 저장: ${path.relative(process.cwd(), file)} (+ .json)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
