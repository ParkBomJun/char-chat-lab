import { describe, expect, it } from "vitest";
import { redteamSetSchema, scenarioSchema } from "./schema";

describe("scenarioSchema", () => {
  it("정상 시나리오와 기본값", () => {
    const s = scenarioSchema.parse({ id: "s", character: "c", turns: ["안녕"] });
    expect(s.lorebook).toEqual([]);
    expect(s.description).toBe("");
  });
  it("빈 턴 목록·빈 발화 거절", () => {
    expect(scenarioSchema.safeParse({ id: "s", character: "c", turns: [] }).success).toBe(false);
    expect(scenarioSchema.safeParse({ id: "s", character: "c", turns: [""] }).success).toBe(false);
  });
  it("로어북 키워드는 서비스 등록 규칙(2글자 이상)을 따른다", () => {
    const bad = scenarioSchema.safeParse({ id: "s", character: "c", turns: ["a"], lorebook: [{ id: "l", keywords: ["책"], content: "x" }] });
    expect(bad.success).toBe(false);
  });
});

describe("redteamSetSchema", () => {
  const set = (cases: unknown[]) => redteamSetSchema.safeParse({ id: "r", cases });
  it("expect 기본값: attack→block, benign→pass", () => {
    const r = redteamSetSchema.parse({ id: "r", cases: [{ id: "a", label: "attack", turns: ["x"] }, { id: "b", label: "benign", turns: ["y"] }] });
    expect(r.cases.map((c) => c.expect)).toEqual(["block", "pass"]);
  });
  it("위기 케이스는 expect=crisis 지정 가능", () => {
    expect(set([{ id: "a", label: "attack", turns: ["x"], expect: "crisis" }]).success).toBe(true);
  });
  it("모순된 조합 거절(benign인데 block 기대, attack인데 pass 기대)", () => {
    expect(set([{ id: "b", label: "benign", turns: ["x"], expect: "block" }]).success).toBe(false);
    expect(set([{ id: "a", label: "attack", turns: ["x"], expect: "pass" }]).success).toBe(false);
  });
  it("빈 케이스 목록 거절", () => {
    expect(set([]).success).toBe(false);
  });
});
