import { describe, expect, it } from "vitest";
import { assemblePrompt, type AssembleConfig, type CharacterCard, type HistoryMessage } from "./assemble";
import { diagnoseCacheBreak, hashText, readPrefixHashes } from "./prefix-diag";
import { buildUsageRow } from "@/lib/usage";

const card: CharacterCard = { name: "하루", persona: "P".repeat(50), speechStyle: "S", exampleDialog: "E" };
const cfg: AssembleConfig = { promptTokenBudget: 100_000, lorebookTokenBudget: 1000 };
const H = (role: HistoryMessage["role"], content: string): HistoryMessage => ({ role, content });
const history = [H("ASSISTANT", "인사"), H("USER", "질문1"), H("ASSISTANT", "답1")];
const lore = [{ id: "l1", content: "설정A", priority: 1 }];
const next = [...history, H("USER", "질문2"), H("ASSISTANT", "답2")];

const hashes = (...a: Parameters<typeof assemblePrompt>) => assemblePrompt(...a).prefix;

describe("hashText", () => {
  it("같은 글은 같은 12자리 해시, 한 글자만 달라도 다르다", () => {
    expect(hashText("가나다")).toMatch(/^[0-9a-f]{12}$/);
    expect(hashText("가나다")).toBe(hashText("가나다"));
    expect(hashText("가나다")).not.toBe(hashText("가나다 "));
  });
});

describe("diagnoseCacheBreak", () => {
  const base = hashes(card, "요약", lore, history, "질문2", cfg);

  it("직전 턴이 없으면 first", () => {
    expect(diagnoseCacheBreak(null, base)).toBe("first");
  });
  it("대화가 뒤에 덧붙기만 하면 none", () => {
    expect(diagnoseCacheBreak(base, hashes(card, "요약", lore, next, "질문3", cfg))).toBe("none");
  });
  it("캐릭터 카드가 바뀌면 fixed", () => {
    expect(diagnoseCacheBreak(base, hashes({ ...card, speechStyle: "S2" }, "요약", lore, next, "질문3", cfg))).toBe("fixed");
  });
  it("요약이 갱신되면 summary(뒤 블록도 같이 바뀌었어도 가장 앞의 원인을 돌려준다)", () => {
    expect(diagnoseCacheBreak(base, hashes(card, "새 요약", [], next.slice(2), "질문3", cfg))).toBe("summary");
  });
  it("요약이 처음 생긴 턴도 summary", () => {
    expect(diagnoseCacheBreak(hashes(card, null, lore, history, "질문2", cfg), base)).toBe("summary");
  });
  it("걸린 로어북이 달라지면 lorebook, 사라져도 lorebook", () => {
    expect(diagnoseCacheBreak(base, hashes(card, "요약", [{ id: "l2", content: "설정B", priority: 1 }], next, "질문3", cfg))).toBe("lorebook");
    expect(diagnoseCacheBreak(base, hashes(card, "요약", [], next, "질문3", cfg))).toBe("lorebook");
  });
  it("로어북이 입력 앞(beforeInput)이면 로어북이 바뀌어도 접두사는 유지된다", () => {
    const c = { ...cfg, lorebookPosition: "beforeInput" as const };
    const a = hashes(card, "요약", lore, history, "질문2", c);
    expect(diagnoseCacheBreak(a, hashes(card, "요약", [{ id: "l2", content: "설정B", priority: 1 }], next, "질문3", c))).toBe("none");
  });
  it("로어북 위치 설정이 바뀌면 layout", () => {
    expect(diagnoseCacheBreak(base, hashes(card, "요약", lore, next, "질문3", { ...cfg, lorebookPosition: "beforeInput" }))).toBe("layout");
  });
  it("예산 초과로 오래된 메시지가 잘려 시작점이 움직이면 recent_window", () => {
    const tight = hashes(card, "요약", lore, next, "질문3", { ...cfg, promptTokenBudget: assemblePrompt(card, "요약", lore, next, "질문3", cfg).blockTokens.total - 1 });
    expect(diagnoseCacheBreak(base, tight)).toBe("recent_window");
  });
  it("직전 턴에 최근 대화가 없었으면 새로 생긴 시작점은 이동이 아니다", () => {
    expect(diagnoseCacheBreak(hashes(card, null, [], [], "첫 입력", cfg), hashes(card, null, [], [H("USER", "첫 입력"), H("ASSISTANT", "답")], "다음", cfg))).toBe("none");
  });
});

describe("저장 형식", () => {
  it("해시와 진단 결과가 blockTokens JSON에 실리고, 원문은 들어가지 않는다", () => {
    const secret = "비밀스러운 요약 문장";
    const a = assemblePrompt(card, secret, lore, [H("USER", "사용자의 사적인 말"), H("ASSISTANT", "답")], "입력", cfg);
    const row = buildUsageRow({
      model: "m",
      usage: null,
      blockTokens: a.blockTokens,
      promptMeta: { lorebookIds: a.lorebookIds, droppedRecent: a.droppedRecent, prefix: a.prefix, cacheBreak: "first" },
      estimatedInputTokens: a.blockTokens.total,
      outputText: "x",
      ttftMs: 1,
      totalMs: 2,
    });
    const json = JSON.stringify(row.blockTokens);
    expect(row.blockTokens).toMatchObject({ cacheBreak: "first", prefix: a.prefix });
    for (const raw of [secret, "사용자의 사적인 말", "설정A", card.persona]) expect(json).not.toContain(raw);
    // 저장한 것을 다시 읽으면 같은 값
    expect(readPrefixHashes(JSON.parse(json))).toEqual(a.prefix);
  });
  it("이전 버전 행(prefix 없음)·형식이 다른 값은 null → first로 처리된다", () => {
    expect(readPrefixHashes(null)).toBeNull();
    expect(readPrefixHashes({ fixed: 10, total: 20 })).toBeNull();
    expect(readPrefixHashes({ prefix: { fixed: "원문이 들어간 값", summary: null, lorebook: null, recentHead: null, lorePos: "afterFixed" } })).toBeNull();
    expect(readPrefixHashes({ prefix: { fixed: "0123456789ab", summary: null, lorebook: null, recentHead: null, lorePos: "elsewhere" } })).toBeNull();
  });
});
