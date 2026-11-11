/**
 * 규칙 층만의 평가(모델 호출 없음, 순수 함수). 케이스의 사용자 발화마다 입력 규칙을 적용해
 * 공격의 적중률과 정상의 오탐률을 낸다. 출력 규칙은 모델 응답이 있어야 하므로 대상이 아니다.
 * HARD = 규칙이 바로 차단·위기 안내, SOFT = 차단하지 않고 분류기에 힌트만 전달(규칙이 두 단계일 때).
 */
import { rate, type Rate } from "./metrics";
import type { RedteamCase, RedteamSet } from "./schema";

export type RuleHit = { kind: "block" | "crisis"; category: string };
/** 문장 하나에 대한 규칙 판정. normalizedOnly는 정규화(공백·기호 제거 등)를 거쳐야만 걸린 경우 */
export type RuleVerdict = { hard: RuleHit | null; soft: (RuleHit & { normalizedOnly?: boolean })[] };
export type RuleEvaluator = (text: string) => RuleVerdict;

export type RuleCaseResult = {
  set: string;
  id: string;
  label: RedteamCase["label"];
  expect: RedteamCase["expect"];
  category: string;
  technique: string | null;
  mutation: string | null;
  mutationOf: string | null;
  /** 처음 HARD로 걸린 턴과 종류. 없으면 null */
  hard: (RuleHit & { turn: number }) | null;
  /** HARD는 없고 SOFT 힌트만 있었나 */
  softOnly: boolean;
  /** SOFT 중 정규화로만 걸린 것이 있었나 */
  softNormalized: boolean;
  /** 공격: 기대한 종류(차단 기대→block, 위기 안내 기대→crisis)로 HARD 적중했나 */
  matched: boolean;
};

export function evalRuleCase(set: string, c: RedteamCase, evaluate: RuleEvaluator): RuleCaseResult {
  let hard: RuleCaseResult["hard"] = null;
  let soft = false;
  let softNormalized = false;
  c.turns.forEach((t, i) => {
    if (hard) return; // HARD로 막힌 뒤의 턴은 서비스에서도 그 대화 흐름이 달라지므로 첫 적중까지만 본다
    const v = evaluate(t);
    if (v.hard) hard = { ...v.hard, turn: i + 1 };
    else if (v.soft.length) {
      soft = true;
      if (v.soft.some((s) => s.normalizedOnly)) softNormalized = true;
    }
  });
  const h = hard as RuleCaseResult["hard"];
  return {
    set,
    id: c.id,
    label: c.label,
    expect: c.expect,
    category: c.category,
    technique: c.technique ?? null,
    mutation: c.mutation ?? null,
    mutationOf: c.mutationOf ?? null,
    hard: h,
    softOnly: !h && soft,
    softNormalized,
    matched: c.label === "attack" && h !== null && h.kind === (c.expect === "crisis" ? "crisis" : "block"),
  };
}

export type RuleGroup = {
  key: string;
  attack: { n: number; hard: Rate; matched: Rate; softOnly: Rate; missed: Rate };
  benign: { n: number; falsePositive: Rate; softOnly: Rate };
};

function group(key: string, rows: readonly RuleCaseResult[]): RuleGroup {
  const a = rows.filter((r) => r.label === "attack");
  const b = rows.filter((r) => r.label === "benign");
  return {
    key,
    attack: {
      n: a.length,
      hard: rate(a.filter((r) => r.hard).length, a.length),
      matched: rate(a.filter((r) => r.matched).length, a.length),
      softOnly: rate(a.filter((r) => r.softOnly).length, a.length),
      missed: rate(a.filter((r) => !r.hard && !r.softOnly).length, a.length),
    },
    benign: { n: b.length, falsePositive: rate(b.filter((r) => r.hard).length, b.length), softOnly: rate(b.filter((r) => r.softOnly).length, b.length) },
  };
}

export const ORIGINAL = "원본(변형 없음)";
export type RulesReport = {
  total: RuleGroup;
  byCategory: RuleGroup[];
  byTechnique: RuleGroup[];
  byMutation: RuleGroup[];
  /** 정상인데 HARD로 걸린 케이스(오탐)와 걸린 범주 */
  falsePositives: { id: string; category: string; rule: string }[];
  /** 정규화로만 걸린 SOFT가 있었던 케이스 수 */
  softNormalizedCases: number;
};

export function summarizeRules(rows: readonly RuleCaseResult[]): RulesReport {
  const by = (f: (r: RuleCaseResult) => string, first?: string) =>
    [...new Set(rows.map(f))].sort((x, y) => (x === first ? -1 : y === first ? 1 : x.localeCompare(y))).map((k) => group(k, rows.filter((r) => f(r) === k)));
  return {
    total: group("전체", rows),
    byCategory: by((r) => r.category),
    byTechnique: by((r) => r.technique || "(미지정)"),
    byMutation: by((r) => r.mutation || ORIGINAL, ORIGINAL),
    falsePositives: rows.filter((r) => r.label === "benign" && r.hard).map((r) => ({ id: r.id, category: r.category, rule: `${r.hard!.kind}/${r.hard!.category}` })),
    softNormalizedCases: rows.filter((r) => r.softNormalized).length,
  };
}

export function evalRuleSets(sets: readonly RedteamSet[], evaluate: RuleEvaluator): RuleCaseResult[] {
  return sets.flatMap((s) => s.cases.map((c) => evalRuleCase(s.id, c, evaluate)));
}

const pct = (r: Rate) => (r.value === null ? "—" : `${(r.value * 100).toFixed(1)}% (${r.k}/${r.n})`);
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const HEAD = ["구분", "공격", "HARD 적중", "기대 종류 일치", "SOFT만(힌트)", "놓침", "정상", "오탐(HARD)", "정상 SOFT만"];
const row = (g: RuleGroup) => [g.key, String(g.attack.n), pct(g.attack.hard), pct(g.attack.matched), pct(g.attack.softOnly), pct(g.attack.missed), String(g.benign.n), pct(g.benign.falsePositive), pct(g.benign.softOnly)];

export type RulesMeta = { runId: string; generatedKst: string; source: string; rulesHash: string; commit: string; mutate: { enabled: boolean; seed: string; perCase: number; variants: number } };

export function renderRulesReport(rep: RulesReport, meta: RulesMeta): string {
  return [
    `# 규칙 층 평가 — ${meta.runId}`,
    "",
    `생성 ${meta.generatedKst} · 입력 표 ${meta.source} · 커밋 ${meta.commit} · 규칙 파일 해시 ${meta.rulesHash} · ${meta.mutate.enabled ? `변형 ${meta.mutate.variants}개 포함(시드 ${meta.mutate.seed}, 원본당 최대 ${meta.mutate.perCase}개)` : "변형 없음"}`,
    "",
    "모델을 한 번도 부르지 않고 **입력 규칙 층만** 적용한 결과입니다. 분류기·출력 검사·흐름 감시는 포함되지 않으므로 서비스 전체의 차단율이 아닙니다. 이 문서에는 케이스 id와 집계만 있고 대화 원문은 없습니다.",
    "",
    "- **HARD 적중**: 규칙이 바로 차단하거나 위기 안내를 낸 공격 케이스의 비율(대화의 어느 턴이든). **기대 종류 일치**: 그중 기대와 같은 종류(차단 기대 → 차단, 위기 안내 기대 → 위기 안내)로 걸린 비율.",
    "- **SOFT만(힌트)**: 차단은 안 하고 분류기에 힌트만 넘긴 케이스. 규칙이 한 단계뿐이면 항상 0입니다. **놓침**: HARD도 SOFT도 없는 케이스(분류기가 혼자 판단).",
    "- **오탐(HARD)**: 정상 케이스가 규칙에 바로 막힌 비율. 정상 SOFT만은 막히지 않고 힌트만 붙은 비율입니다.",
    "",
    "## 전체",
    "",
    table(HEAD, [row(rep.total)]),
    "",
    "## 범주별",
    "",
    table(HEAD, rep.byCategory.map(row)),
    "",
    "## 기법별",
    "",
    table(HEAD, rep.byTechnique.map(row)),
    "",
    "## 변형 기법별",
    "",
    table(HEAD, rep.byMutation.map(row)),
    "",
    `## 정상 케이스 오탐 (${rep.falsePositives.length}건)`,
    "",
    rep.falsePositives.length ? table(["케이스", "범주", "걸린 규칙(종류/범주)"], rep.falsePositives.map((f) => [f.id, f.category, f.rule])) : "없음",
    "",
    `정규화를 거쳐야만 걸린 SOFT가 있었던 케이스: ${rep.softNormalizedCases}건`,
  ].join("\n") + "\n";
}

/** 두 실행(전/후)의 전체·변형 기법별 비교표. docs에 넣을 수 있게 집계만 쓴다. */
export function renderRulesComparison(before: RulesReport, after: RulesReport): string {
  const cell = (b: Rate, a: Rate) => `${pct(b)} → ${pct(a)}`;
  const keys = [...new Set([...before.byMutation, ...after.byMutation].map((g) => g.key))];
  const find = (rep: RulesReport, k: string) => rep.byMutation.find((g) => g.key === k) ?? group(k, []);
  const line = (name: string, b: RuleGroup, a: RuleGroup) => [name, String(a.attack.n), cell(b.attack.hard, a.attack.hard), cell(b.attack.softOnly, a.attack.softOnly), cell(b.attack.missed, a.attack.missed)];
  return [
    table(["구분", "공격 케이스", "HARD 적중 (전 → 후)", "SOFT만 (전 → 후)", "놓침 (전 → 후)"], [line("전체", before.total, after.total), ...keys.map((k) => line(k, find(before, k), find(after, k)))]),
    "",
    table(["정상 케이스", "오탐(HARD) (전 → 후)", "SOFT만 (전 → 후)"], [[String(after.total.benign.n), cell(before.total.benign.falsePositive, after.total.benign.falsePositive), cell(before.total.benign.softOnly, after.total.benign.softOnly)]]),
  ].join("\n");
}
