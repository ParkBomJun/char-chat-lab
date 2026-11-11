import { describe, expect, it } from "vitest";
import { buildUsageRow } from "./usage";
import type { PricingTable } from "./pricing";

const table: PricingTable = {
  default: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },
  models: { m: { inputPer1M: 1_000_000, cachedInputPer1M: 500_000, outputPer1M: 2_000_000 } }, // 토큰당 $1 / $0.5 / $2
};
const bt = { fixed: 10, summary: 0, lorebook: 0, recent: 5, input: 5, total: 20 };

describe("buildUsageRow", () => {
  it("제공사 usage가 있으면 그대로 쓰고 estimated=false", () => {
    const r = buildUsageRow(
      { model: "m", usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 }, blockTokens: bt, estimatedInputTokens: bt.total, outputText: "x", ttftMs: 120, totalMs: 900 },
      table,
    );
    expect(r).toMatchObject({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 10, usageEstimated: false, ttftMs: 120, totalMs: 900 });
    expect(r.estCost).toBe("100.00000000"); // 60*1 + 40*0.5 + 10*2
  });
  it("usage.cost가 있으면 actualCost로 저장하고 estCost는 그대로 둔다", () => {
    const r = buildUsageRow(
      { model: "m", usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10, cost: 0.0012345 }, blockTokens: bt, estimatedInputTokens: bt.total, outputText: "x", ttftMs: 1, totalMs: 2 },
      table,
    );
    expect(r.actualCost).toBe("0.00123450");
    expect(r.estCost).toBe("100.00000000");
  });
  it("cost가 없거나 usage가 추정이면 actualCost는 null", () => {
    const a = buildUsageRow({ model: "m", usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, blockTokens: bt, estimatedInputTokens: 1, outputText: "x", ttftMs: 1, totalMs: 2 }, table);
    const b = buildUsageRow({ model: "m", usage: null, blockTokens: bt, estimatedInputTokens: 1, outputText: "x", ttftMs: 1, totalMs: 2 }, table);
    expect(a.actualCost).toBeNull();
    expect(b.actualCost).toBeNull();
  });
  it("usage가 없으면 조립기 추정 total과 출력 글자 수로 추정, estimated=true", () => {
    const r = buildUsageRow({ model: "m", usage: null, blockTokens: bt, estimatedInputTokens: bt.total, outputText: "안녕하세요", ttftMs: null, totalMs: 50 }, table);
    expect(r).toMatchObject({ inputTokens: 20, cachedInputTokens: 0, outputTokens: 5, usageEstimated: true, ttftMs: null });
  });
  it("promptMeta(로어북 id 등)는 blockTokens JSON에 합쳐진다", () => {
    const r = buildUsageRow(
      { model: "m", usage: null, blockTokens: bt, promptMeta: { lorebookIds: ["l1"], droppedRecent: 2 }, estimatedInputTokens: 20, outputText: "a", ttftMs: 1, totalMs: 2 },
      table,
    );
    expect(r.blockTokens).toEqual({ ...bt, lorebookIds: ["l1"], droppedRecent: 2 });
  });
  it("요약 호출은 blockTokens 없이 기록", () => {
    const r = buildUsageRow({ model: "m", usage: null, blockTokens: null, estimatedInputTokens: 77, outputText: "abc", ttftMs: null, totalMs: 9 }, table);
    expect(r).toMatchObject({ inputTokens: 77, outputTokens: 3, usageEstimated: true, blockTokens: null });
  });
  it("단가 0이면 비용 0", () => {
    const r = buildUsageRow({ model: "other", usage: null, blockTokens: bt, estimatedInputTokens: bt.total, outputText: "a", ttftMs: 1, totalMs: 2 }, table);
    expect(Number(r.estCost)).toBe(0);
  });
});
