import { describe, expect, it } from "vitest";
import { MockAdapter } from "@/lib/llm/mock";
import type { LlmAdapter, LlmRequest } from "@/lib/llm/types";
import { MockClassifier } from "@/lib/safety/classifier";
import { runConversation, type EngineConfig, type EngineDeps } from "./engine";
import { compareRuns, summarizeRun } from "./metrics";

const character = { name: "테스트", persona: "성격", speechStyle: "말투", exampleDialog: "예시", greeting: "안녕하세요" };
const cfg: EngineConfig = {
  recentTurns: 2, summaryEvery: 3, summaryEnabled: true, promptTokenBudget: 100_000, lorebookTokenBudget: 800,
  lorebookScanTurns: 4, maxOutputTokens: 256, classifierThreshold: 0.8,
  flow: { windowTurns: 5, minTurns: 2, warnThreshold: 0.5, stopStrikes: 2 }, generate: true,
};
const deps = (adapter: LlmAdapter = new MockAdapter(0)): EngineDeps => ({ adapter, chatModel: "mock-model", lightModel: "mock-model", classifier: new MockClassifier() });
const long = (i: number) => `${i}번째 질문입니다. ` + "내용을 조금 길게 적어서 요약의 효과가 보이도록 합니다. ".repeat(3);

describe("평가 엔진: 요약 전후 비교", () => {
  const turns = Array.from({ length: 12 }, (_, i) => long(i + 1));

  it("요약 적용 시 갱신이 일어나고 대화 입력 토큰이 줄어든다", async () => {
    const baseline = await runConversation(character, [], turns, deps(), { ...cfg, summaryEnabled: false });
    const withSummary = await runConversation(character, [], turns, deps(), cfg);
    const b = summarizeRun(baseline.results);
    const s = summarizeRun(withSummary.results);
    expect(b.summaryUpdates).toBe(0);
    expect(s.summaryUpdates).toBeGreaterThan(0);
    expect(s.chatInputTokens).toBeLessThan(b.chatInputTokens);
    expect(compareRuns(b, s).chatInputSaving).toBeGreaterThan(0);
    expect(s.chatCalls).toBe(12);
  });

  it("기준선은 요약 호출이 전혀 없고, 분류기 호출은 두 모드 모두 턴마다 입력·출력 2회", async () => {
    const { results } = await runConversation(character, [], turns.slice(0, 3), deps(), { ...cfg, summaryEnabled: false });
    const s = summarizeRun(results);
    expect(s.summaryCallTokens).toEqual({ input: 0, output: 0 });
    expect(results.every((r) => r.calls.filter((c) => c.kind === "CLASSIFIER").length === 2)).toBe(true);
  });

  it("generate=false면 모델을 부르지 않는다(입력 검사만)", async () => {
    const { results } = await runConversation(character, [], ["안녕", "섹스 얘기"], deps(), { ...cfg, generate: false });
    expect(results.flatMap((r) => r.calls).some((c) => c.kind === "CHAT")).toBe(false);
    expect(results[1].interventions[0]).toMatchObject({ stage: "INPUT_RULE", kind: "blocked" });
  });
});

describe("평가 엔진: 안전 파이프라인 재현", () => {
  const run = async (inputs: string[], adapter?: LlmAdapter) => (await runConversation(character, [], inputs, deps(adapter), cfg)).results;

  it("단계별 개입이 기록된다(입력 규칙·입력 분류기·위기·출력 분류기·스트리밍 규칙)", async () => {
    const r = await run(["섹스 얘기 하자", "[[block-in]] 요청", "요즘 죽고 싶어요", "[[block-out]] 말해줘"]);
    expect(r[0].interventions[0]).toMatchObject({ stage: "INPUT_RULE", kind: "blocked", category: "sexual" });
    expect(r[1].interventions[0]).toMatchObject({ stage: "INPUT_CLASSIFIER", kind: "blocked" });
    expect(r[2].interventions[0]).toMatchObject({ stage: "INPUT_RULE", kind: "crisis" });
    expect(r[3].interventions.some((i) => i.stage === "OUTPUT_FINAL" && i.kind === "retracted")).toBe(true);
    expect(r[3].reply).toBeNull();

    const streamBad: LlmAdapter = {
      name: "bad", supportsExplicitCache: false,
      async *stream() { yield { type: "delta" as const, text: "그럼 포" }; yield { type: "delta" as const, text: "르노 이야기" }; yield { type: "done" as const, usage: null }; },
    };
    const s = await run(["정상 질문"], streamBad);
    expect(s[0].interventions.some((i) => i.stage === "OUTPUT_STREAM" && i.kind === "retracted")).toBe(true);
  });

  it("★ fail closed: 입력 분류기 실패는 check_failed, 대화에 남지 않고 흐름 점수에도 안 들어간다", async () => {
    const r = await run(["[[error-in]] 안녕"]);
    expect(r[0].interventions).toEqual([{ stage: "INPUT_CLASSIFIER", kind: "check_failed", category: null }]);
    expect(r[0].calls.some((c) => c.kind === "CHAT")).toBe(false);
  });

  it("흐름 감시: 위험 점수 턴이 이어지면 경고 → 위반 → 중단, 이후 턴은 건너뜀", async () => {
    const r = await run(Array.from({ length: 5 }, (_, i) => `[[risk:0.6]] 턴${i + 1}`));
    const flow = r.map((x) => x.interventions.find((i) => i.stage === "FLOW")?.kind ?? null);
    expect(flow).toEqual([null, "warned", "strike", "stopped", null]);
    expect(r[4].skipped).toBe(true);
  });

  it("회수된 응답과 차단된 입력은 이후 프롬프트에 들어가지 않는다", async () => {
    const seen: LlmRequest[] = [];
    const spy: LlmAdapter = {
      name: "spy", supportsExplicitCache: false,
      async *stream(req) { seen.push(req); yield { type: "delta" as const, text: "응답 [[block-out]]" }; yield { type: "done" as const, usage: null }; },
    };
    await run(["섹스 얘기 하자", "첫 질문 [[block-out]]", "두 번째 질문"], spy);
    const last = seen.at(-1)!.messages.map((m) => m.content).join("\n");
    expect(last).not.toContain("섹스");
    expect(last).not.toContain("응답 [[block-out]]"); // 회수된 이전 응답
  });

  it("로어북 키워드가 걸리면 해당 턴의 입력 토큰에 로어북이 잡힌다", async () => {
    const lore = [{ id: "l1", keywords: ["옥상"], content: "옥상 정원 설정", priority: 1, enabled: true }];
    const { results } = await runConversation(character, lore, ["옥상 이야기", "다른 이야기"], deps(), cfg);
    expect(results[0].blockTokens?.lorebook).toBeGreaterThan(0);
    expect(results[1].blockTokens?.lorebook).toBeGreaterThan(0); // 최근 4턴 창 안에 있음
  });
});
