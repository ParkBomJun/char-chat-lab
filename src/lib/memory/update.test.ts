import { describe, expect, it, vi } from "vitest";
import { runSummaryUpdate, type SummaryDeps, type SummaryState } from "./update";

const cfg = { recentTurns: 20, summaryEvery: 10 };

function state(turns: number, previous: SummaryState["previous"] = null): SummaryState {
  const messages: SummaryState["messages"] = [{ id: "g", role: "ASSISTANT", content: "인사" }];
  for (let i = 1; i <= turns; i++) {
    messages.push({ id: `u${i}`, role: "USER", content: `질문${i}` }, { id: `a${i}`, role: "ASSISTANT", content: `답${i}` });
  }
  return { characterName: "하루", previous, messages };
}

function deps(s: SummaryState | null, over: Partial<SummaryDeps> = {}) {
  const d = {
    load: vi.fn(async () => s),
    summarize: vi.fn<SummaryDeps["summarize"]>(async () => ({
      text: "새 요약",
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 3 },
      totalMs: 5,
    })),
    logUsage: vi.fn(async () => {}),
    save: vi.fn<SummaryDeps["save"]>(async () => true),
  };
  Object.assign(d, over); // 타입은 vi.fn 기본형을 유지(.mock 접근용)
  return d;
}

describe("runSummaryUpdate", () => {
  it("기준 미만이면 LLM을 부르지 않는다", async () => {
    const d = deps(state(29));
    expect(await runSummaryUpdate(d, cfg)).toEqual({ updated: false, reason: "not-needed" });
    expect(d.summarize).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it("30턴이면 첫 10턴을 요약해 version 1로 저장", async () => {
    const d = deps(state(30));
    const r = await runSummaryUpdate(d, cfg);
    expect(r).toEqual({ updated: true, version: 1, summarizedMessages: 21 });
    expect(d.save).toHaveBeenCalledWith({ content: "새 요약", coversUntilMsg: "a10", version: 1 });
    expect(d.logUsage).toHaveBeenCalledTimes(1);
    const prompt = d.summarize.mock.calls[0][0];
    expect(prompt[1].content).toContain("질문10");
    expect(prompt[1].content).not.toContain("질문11");
  });

  it("기존 요약이 있으면 프롬프트에 넣고 version을 올린다", async () => {
    const prev = { content: "이전 요약", version: 3, coversUntilMsg: "a10" };
    const s = state(40, prev);
    s.messages = s.messages.slice(21); // 요약이 덮은 g..a10 제외
    const d = deps(s);
    const r = await runSummaryUpdate(d, cfg);
    expect(r).toMatchObject({ updated: true, version: 4 });
    expect(d.save).toHaveBeenCalledWith({ content: "새 요약", coversUntilMsg: "a20", version: 4 });
    expect(d.summarize.mock.calls[0][0][1].content).toContain("이전 요약");
  });

  it("빈 출력이면 저장하지 않지만 호출 비용은 기록", async () => {
    const d = deps(state(30), { summarize: vi.fn(async () => ({ text: "  \n", usage: null, totalMs: 1 })) });
    expect(await runSummaryUpdate(d, cfg)).toEqual({ updated: false, reason: "empty-output" });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.logUsage).toHaveBeenCalledTimes(1);
  });

  it("동시 갱신으로 저장이 충돌하면 conflict", async () => {
    const d = deps(state(30), { save: vi.fn(async () => false) });
    expect(await runSummaryUpdate(d, cfg)).toEqual({ updated: false, reason: "conflict" });
  });

  it("요약 호출이 던지면 그대로 전파(호출 측이 로그 후 다음 턴에 재시도)", async () => {
    const d = deps(state(30), { summarize: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(runSummaryUpdate(d, cfg)).rejects.toThrow("boom");
    expect(d.save).not.toHaveBeenCalled();
  });

  it("모델이 길게 써도 저장 길이에 상한", async () => {
    const d = deps(state(30), { summarize: vi.fn(async () => ({ text: "가".repeat(5000), usage: null, totalMs: 1 })) });
    await runSummaryUpdate(d, cfg);
    expect(d.save.mock.calls[0][0].content.length).toBeLessThanOrEqual(1600);
  });

  it("상태 없음(대화 삭제 등)이면 아무것도 안 한다", async () => {
    expect(await runSummaryUpdate(deps(null), cfg)).toEqual({ updated: false, reason: "no-state" });
  });
});
