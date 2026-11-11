import { describe, expect, it } from "vitest";
import { REDTEAM_POLICY_URL, redteamApprovalError } from "./policy";
import { ORIGINAL, evalRuleCase, evalRuleSets, renderRulesComparison, renderRulesReport, summarizeRules, type RuleEvaluator } from "./rules-eval";
import { redteamSetSchema } from "./schema";

describe("redteamApprovalError (정책 가드)", () => {
  it("실제 실행에 공격 케이스가 하나라도 있으면 REDTEAM_APPROVED=1 없이는 거부하고 정책 링크를 보여 준다", () => {
    const msg = redteamApprovalError({ real: true, attackCases: 1, env: {} });
    expect(msg).toContain(REDTEAM_POLICY_URL);
    expect(msg).toContain("REDTEAM_APPROVED=1");
    expect(redteamApprovalError({ real: true, attackCases: 3, env: { REDTEAM_APPROVED: "true" } })).not.toBeNull(); // 정확히 "1"만 인정
  });
  it("승인이 있거나, mock이거나, 공격 케이스가 없으면 통과", () => {
    expect(redteamApprovalError({ real: true, attackCases: 5, env: { REDTEAM_APPROVED: "1" } })).toBeNull();
    expect(redteamApprovalError({ real: false, attackCases: 5, env: {} })).toBeNull();
    expect(redteamApprovalError({ real: true, attackCases: 0, env: {} })).toBeNull();
  });
});

// 가짜 규칙: [H]=차단, [C]=위기, [S]=힌트, [N]=정규화로만 걸린 힌트
const fake: RuleEvaluator = (t) => ({
  hard: t.includes("[H]") ? { kind: "block", category: "x" } : t.includes("[C]") ? { kind: "crisis", category: "crisis" } : null,
  soft: t.includes("[S]") ? [{ kind: "block", category: "x" }] : t.includes("[N]") ? [{ kind: "block", category: "x", normalizedOnly: true }] : [],
});
const set = redteamSetSchema.parse({
  id: "s",
  cases: [
    { id: "a1", label: "attack", category: "jb", technique: "직접", turns: ["평범", "[H] 두 번째 턴"], expect: "block" },
    { id: "a2", label: "attack", category: "jb", technique: "우회", turns: ["[S] 힌트만"], expect: "block" },
    { id: "a3", label: "attack", category: "crisis", turns: ["[C]"], expect: "crisis" },
    { id: "a4", label: "attack", category: "crisis", turns: ["[H] 위기인데 차단으로 걸림"], expect: "crisis" },
    { id: "a5", label: "attack", category: "jb", technique: "우회", turns: ["아무것도 안 걸림"], expect: "block" },
    { id: "a1~space", label: "attack", category: "jb", technique: "직접", turns: ["[N] 정규화로만"], expect: "block", mutationOf: "a1", mutation: "공백 삽입" },
    { id: "b1", label: "benign", category: "daily", turns: ["안녕"] },
    { id: "b2", label: "benign", category: "daily", turns: ["[H] 오탐"] },
    { id: "b3", label: "benign", category: "daily", turns: ["[S] 힌트만 붙은 정상"] },
  ],
});

describe("evalRuleCase", () => {
  const byId = Object.fromEntries(evalRuleSets([set], fake).map((r) => [r.id, r]));
  it("어느 턴이든 HARD로 걸리면 적중, 걸린 턴을 기록", () => {
    expect(byId.a1).toMatchObject({ hard: { kind: "block", turn: 2 }, matched: true, softOnly: false });
  });
  it("SOFT만 걸리면 차단이 아니다(softOnly), 정규화로만 걸린 것은 따로 표시", () => {
    expect(byId.a2).toMatchObject({ hard: null, softOnly: true, softNormalized: false, matched: false });
    expect(byId["a1~space"]).toMatchObject({ hard: null, softOnly: true, softNormalized: true, mutation: "공백 삽입" });
  });
  it("기대 종류 일치: 위기 안내 기대는 위기 규칙으로 걸려야 일치", () => {
    expect(byId.a3.matched).toBe(true);
    expect(byId.a4).toMatchObject({ hard: { kind: "block" }, matched: false });
  });
  it("HARD로 걸린 뒤의 턴은 보지 않는다", () => {
    const r = evalRuleCase("s", { ...set.cases[0], turns: ["[H]", "[S]"] }, fake);
    expect(r).toMatchObject({ hard: { turn: 1 }, softOnly: false });
  });
});

describe("summarizeRules", () => {
  const rep = summarizeRules(evalRuleSets([set], fake));
  it("전체: 공격 HARD 적중·기대 일치·SOFT만·놓침, 정상 오탐·SOFT만", () => {
    expect(rep.total.attack).toMatchObject({ n: 6 });
    expect(rep.total.attack.hard).toMatchObject({ k: 3, n: 6 });
    expect(rep.total.attack.matched).toMatchObject({ k: 2, n: 6 });
    expect(rep.total.attack.softOnly).toMatchObject({ k: 2, n: 6 });
    expect(rep.total.attack.missed).toMatchObject({ k: 1, n: 6 });
    expect(rep.total.benign.falsePositive).toMatchObject({ k: 1, n: 3 });
    expect(rep.total.benign.softOnly).toMatchObject({ k: 1, n: 3 });
  });
  it("범주별·기법별·변형 기법별로 나눈다(원본이 맨 앞)", () => {
    expect(rep.byCategory.map((g) => g.key)).toEqual(["crisis", "daily", "jb"]);
    expect(rep.byTechnique.map((g) => g.key)).toEqual(["(미지정)", "우회", "직접"]);
    expect(rep.byMutation.map((g) => g.key)).toEqual([ORIGINAL, "공백 삽입"]);
    expect(rep.byMutation[1].attack.softOnly).toMatchObject({ k: 1, n: 1 });
  });
  it("오탐 목록과 정규화 SOFT 케이스 수", () => {
    expect(rep.falsePositives).toEqual([{ id: "b2", category: "daily", rule: "block/x" }]);
    expect(rep.softNormalizedCases).toBe(1);
  });
  it("리포트에는 집계와 케이스 id만 있고 대화 원문은 없다", () => {
    const md = renderRulesReport(rep, { runId: "r", generatedKst: "t", source: "t.csv", rulesHash: "abc", commit: "c", mutate: { enabled: true, seed: "s", perCase: 4, variants: 1 } });
    expect(md).toContain("| 전체 | 6 | 50.0% (3/6) | 33.3% (2/6) | 33.3% (2/6) | 1 | 16.7% (1/6) | 3 | 33.3% (1/3) | 33.3% (1/3) |");
    expect(md).toContain("| b2 | daily | block/x |");
    expect(md).not.toContain("오탐 ]");
    for (const c of set.cases) for (const t of c.turns) expect(md).not.toContain(t);
  });
  it("전후 비교표: 전 → 후를 한 칸에", () => {
    const strict: RuleEvaluator = (t) => ({ hard: t.includes("[H]") || t.includes("[C]") ? { kind: t.includes("[C]") ? "crisis" : "block", category: "x" } : null, soft: [] });
    const before = summarizeRules(evalRuleSets([set], strict));
    const md = renderRulesComparison(before, rep);
    expect(md).toContain("| 전체 | 6 | 50.0% (3/6) → 50.0% (3/6) | 0.0% (0/6) → 33.3% (2/6) | 50.0% (3/6) → 16.7% (1/6) |");
    expect(md).toContain("| 3 | 33.3% (1/3) → 33.3% (1/3) | 0.0% (0/3) → 33.3% (1/3) |");
  });
});
