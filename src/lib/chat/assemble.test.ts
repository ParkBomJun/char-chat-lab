import { describe, expect, it } from "vitest";
import {
  SAFETY_INSTRUCTION,
  assemblePrompt,
  renderFixedBlock,
  type AssembleConfig,
  type CharacterCard,
  type HistoryMessage,
} from "./assemble";

const card: CharacterCard = { name: "하루", persona: "P".repeat(50), speechStyle: "S", exampleDialog: "E" };
const cfg: AssembleConfig = { promptTokenBudget: 100_000, lorebookTokenBudget: 1000 };
const H = (role: HistoryMessage["role"], content: string): HistoryMessage => ({ role, content });

describe("블록 순서 (SPEC 3-2)", () => {
  it("고정 → 요약 → 로어북 → 최근 대화 → 이번 입력", () => {
    const r = assemblePrompt(
      card,
      "요약 내용",
      [{ id: "l1", content: "설정A", priority: 1 }],
      [H("ASSISTANT", "인사"), H("USER", "질문"), H("ASSISTANT", "답")],
      "이번 입력",
      cfg,
    );
    expect(r.messages.map((m) => m.role)).toEqual(["system", "system", "system", "assistant", "user", "assistant", "user"]);
    expect(r.messages[0].content).toBe(renderFixedBlock(card));
    expect(r.messages[1].content).toContain("요약 내용");
    expect(r.messages[2].content).toContain("설정A");
    expect(r.messages.at(-1)).toEqual({ role: "user", content: "이번 입력" });
  });

  it("요약·로어북이 없으면 해당 블록 자체가 없다", () => {
    const r = assemblePrompt(card, null, [], [], "안녕", cfg);
    expect(r.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(r.blockTokens.summary).toBe(0);
    expect(r.blockTokens.lorebook).toBe(0);
  });

  it("안전 지시가 시스템 프롬프트 맨 앞, 캐릭터 설정보다 앞", () => {
    const sys = assemblePrompt(card, null, [], [], "x", cfg).messages[0].content;
    expect(sys.startsWith(SAFETY_INSTRUCTION)).toBe(true);
  });

  it("SYSTEM_NOTICE는 모델에 보내지 않는다", () => {
    const r = assemblePrompt(card, null, [], [H("USER", "a"), H("SYSTEM_NOTICE", "안내"), H("ASSISTANT", "b")], "c", cfg);
    expect(r.messages.some((m) => m.content === "안내")).toBe(false);
  });
});

describe("캐시 안정성 (접두사가 유지되는가)", () => {
  it("이전 턴 프롬프트(이번 입력 포함)가 다음 턴 프롬프트의 접두사", () => {
    const h1: HistoryMessage[] = [H("ASSISTANT", "인사")];
    const t1 = assemblePrompt(card, null, [], h1, "첫 질문", cfg);
    const h2 = [...h1, H("USER", "첫 질문"), H("ASSISTANT", "첫 답")];
    const t2 = assemblePrompt(card, null, [], h2, "둘째 질문", cfg);
    // t1 전체가 t2의 앞부분과 같아야 제공사 캐시가 이어서 적중한다.
    expect(t2.messages.slice(0, t1.messages.length)).toEqual(t1.messages);
  });

  it("고정 블록은 요약·로어북·대화가 바뀌어도 바이트 단위로 동일", () => {
    const a = assemblePrompt(card, null, [], [], "a", cfg).messages[0];
    const b = assemblePrompt(card, "요약", [{ id: "x", content: "c", priority: 0 }], [H("USER", "u")], "b", cfg).messages[0];
    expect(a).toEqual(b);
  });

  it("순수 함수: 같은 입력이면 같은 출력", () => {
    const args = [card, "요약", [{ id: "x", content: "c", priority: 0 }], [H("USER", "u")], "b", cfg] as const;
    expect(assemblePrompt(...args)).toEqual(assemblePrompt(...args));
  });
});

describe("토큰 예산", () => {
  it("블록별 토큰 합이 total", () => {
    const r = assemblePrompt(card, "요약", [{ id: "x", content: "설정", priority: 0 }], [H("USER", "u"), H("ASSISTANT", "v")], "입력", cfg);
    const b = r.blockTokens;
    expect(b.fixed + b.summary + b.lorebook + b.recent + b.input).toBe(b.total);
    expect(b.fixed).toBeGreaterThan(0);
  });

  it("넘치면 최근 대화의 오래된 것부터 자른다", () => {
    const fixed = renderFixedBlock(card).length;
    const history = [H("USER", "1".repeat(100)), H("ASSISTANT", "2".repeat(100)), H("USER", "3".repeat(100)), H("ASSISTANT", "4".repeat(100))];
    const r = assemblePrompt(card, null, [], history, "x".repeat(10), { ...cfg, promptTokenBudget: fixed + 10 + 200 });
    const contents = r.messages.slice(1, -1).map((m) => m.content[0]);
    expect(contents).toEqual(["3", "4"]);
    expect(r.droppedRecent).toBe(2);
    expect(r.overBudget).toBe(false);
  });

  it("중간 메시지만 빼지 않고 항상 최신 쪽 연속 구간을 유지", () => {
    const fixed = renderFixedBlock(card).length;
    const history = [H("USER", "a"), H("ASSISTANT", "B".repeat(500)), H("USER", "c")];
    const r = assemblePrompt(card, null, [], history, "x", { ...cfg, promptTokenBudget: fixed + 1 + 10 });
    expect(r.messages.slice(1, -1).map((m) => m.content)).toEqual(["c"]);
  });

  it("고정 블록과 이번 입력은 예산을 넘어도 자르지 않고 overBudget 표시", () => {
    const longInput = "입".repeat(500);
    const r = assemblePrompt(card, null, [], [H("USER", "old")], longInput, { ...cfg, promptTokenBudget: 10 });
    expect(r.messages[0].content).toBe(renderFixedBlock(card));
    expect(r.messages.at(-1)?.content).toBe(longInput);
    expect(r.messages.length).toBe(2);
    expect(r.overBudget).toBe(true);
  });
});

describe("로어북 예산 (SPEC 3-4)", () => {
  const hits = [
    { id: "low", content: "L".repeat(40), priority: 1 },
    { id: "high", content: "H".repeat(40), priority: 9 },
    { id: "mid", content: "M".repeat(40), priority: 5 },
  ];
  it("넘치면 우선순위 낮은 것부터 뺀다", () => {
    const r = assemblePrompt(card, null, hits, [], "x", { ...cfg, lorebookTokenBudget: 12 + 2 * 43 });
    expect(r.lorebookIds.sort()).toEqual(["high", "mid"]);
  });
  it("예산 0이면 로어북 블록 없음", () => {
    const r = assemblePrompt(card, null, hits, [], "x", { ...cfg, lorebookTokenBudget: 0 });
    expect(r.lorebookIds).toEqual([]);
    expect(r.messages.length).toBe(2);
  });
  it("선택된 항목은 원래 입력 순서로 렌더된다(출력 안정성)", () => {
    const r = assemblePrompt(card, null, hits, [], "x", cfg);
    const text = r.messages[1].content;
    expect(text.indexOf("L")).toBeLessThan(text.indexOf("H"));
  });
});

describe("캐시 옵션(기본값은 지금 동작 그대로)", () => {
  const hist = [H("USER", "a".repeat(3000)), H("ASSISTANT", "b".repeat(3000))];
  const lore = [{ id: "l1", content: "설정A", priority: 1 }];

  it("옵션을 안 주면 breakpoint 표시도 없고 로어북은 고정 블록 바로 뒤", () => {
    const r = assemblePrompt(card, null, lore, hist, "입력", cfg);
    expect(r.messages.some((m) => "cacheBreakpoint" in m)).toBe(false);
    expect(r.cacheBreakpointIndex).toBeNull();
    expect(r.cachePrefixTokens).toBeNull();
    expect(r.messages[1].content).toContain("설정A");
  });

  it("lorebookPosition=beforeInput: 최근 대화 뒤·이번 입력 바로 앞, 다른 순서·내용은 같다", () => {
    const a = assemblePrompt(card, null, lore, hist, "입력", cfg);
    const b = assemblePrompt(card, null, lore, hist, "입력", { ...cfg, lorebookPosition: "beforeInput" });
    expect(b.messages.at(-1)).toEqual({ role: "user", content: "입력" });
    expect(b.messages.at(-2)?.content).toContain("설정A");
    expect(b.messages.map((m) => m.content).sort()).toEqual(a.messages.map((m) => m.content).sort());
    expect(b.blockTokens).toEqual(a.blockTokens);
  });

  it("로어북이 바뀌어도 beforeInput이면 앞부분(고정+대화)이 그대로라 접두사가 유지된다", () => {
    const o = { ...cfg, lorebookPosition: "beforeInput" as const };
    const a = assemblePrompt(card, null, lore, hist, "입력1", o).messages;
    const b = assemblePrompt(card, null, [{ id: "l2", content: "다른 설정", priority: 1 }], hist, "입력2", o).messages;
    expect(a.slice(0, -2)).toEqual(b.slice(0, -2));
  });

  it("cacheBreakpoint: 이번 입력 직전의 마지막 안정 메시지에 표시(앞부분 환산이 최소 길이 이상일 때)", () => {
    const big = [H("USER", "a".repeat(8000)), H("ASSISTANT", "b".repeat(8000))];
    const r = assemblePrompt(card, null, [], big, "입력", { ...cfg, cacheBreakpoint: true });
    expect(r.cacheBreakpointIndex).toBe(r.messages.length - 2);
    expect(r.messages[r.messages.length - 2].cacheBreakpoint).toBe(true);
    expect(r.messages.filter((m) => m.cacheBreakpoint)).toHaveLength(1);
    expect(r.messages.at(-1)?.cacheBreakpoint).toBeUndefined();
  });

  it("★ 표시 위치 기본값은 beforeInput(지금 동작): 옵션을 주지 않으면 이번 입력 직전 메시지, 턴이 늘면 뒤로 옮겨 간다", () => {
    const big = [H("USER", "a".repeat(8000)), H("ASSISTANT", "b".repeat(8000))];
    const o = { ...cfg, cacheBreakpoint: true };
    const r1 = assemblePrompt(card, null, [], big, "입력", o);
    const r1explicit = assemblePrompt(card, null, [], big, "입력", { ...o, cacheBreakpointPosition: "beforeInput" });
    expect(r1.cacheBreakpointIndex).toBe(r1.messages.length - 2);
    expect(r1explicit.messages).toEqual(r1.messages);
    const r2 = assemblePrompt(card, null, [], [...big, H("USER", "입력"), H("ASSISTANT", "응답")], "다음 입력", o);
    expect(r2.cacheBreakpointIndex).toBe(r2.messages.length - 2);
    expect(r2.cacheBreakpointIndex).toBeGreaterThan(r1.cacheBreakpointIndex!);
  });

  it("fixedBlock: 표시는 항상 고정 블록(첫 메시지)에만 붙고 턴이 늘어도 위치가 같다. 최소 길이는 고정 블록만으로 판정", () => {
    const big = [H("USER", "a".repeat(8000)), H("ASSISTANT", "b".repeat(8000))];
    const o = { ...cfg, cacheBreakpoint: true, cacheBreakpointPosition: "fixedBlock" as const, cacheMinTokens: 1 };
    const r1 = assemblePrompt(card, null, lore, big, "입력", o);
    const r2 = assemblePrompt(card, null, lore, [...big, H("USER", "입력"), H("ASSISTANT", "응답")], "다음 입력", o);
    for (const r of [r1, r2]) {
      expect(r.cacheBreakpointIndex).toBe(0);
      expect(r.messages[0].role).toBe("system");
      expect(r.messages.filter((m) => m.cacheBreakpoint)).toHaveLength(1);
    }
    expect(r2.messages[0]).toEqual(r1.messages[0]); // 고정 블록까지의 앞부분이 턴마다 같다
    // 이력이 아무리 길어도 고정 블록이 최소 길이 미만이면 붙이지 않는다(이 테스트 카드의 고정 블록은 짧다)
    expect(assemblePrompt(card, null, [], big, "입력", { ...o, cacheMinTokens: 3500 }).cacheBreakpointIndex).toBeNull();
    // 표시를 끄면 위치 옵션은 아무 영향이 없다
    expect(assemblePrompt(card, null, [], big, "입력", { ...cfg, cacheBreakpointPosition: "fixedBlock" }).messages.some((m) => m.cacheBreakpoint)).toBe(false);
  });

  it("로어북이 입력 앞에 있으면 breakpoint는 로어북이 아니라 그 앞의 안정 메시지", () => {
    const big = [H("USER", "a".repeat(8000)), H("ASSISTANT", "b".repeat(8000))];
    const r = assemblePrompt(card, null, lore, big, "입력", { ...cfg, cacheBreakpoint: true, lorebookPosition: "beforeInput" });
    expect(r.cacheBreakpointIndex).toBe(r.messages.length - 3);
    expect(r.messages[r.cacheBreakpointIndex!].content).toBe("b".repeat(8000));
  });

  it("앞부분 환산 토큰이 최소 길이 미만이면 붙이지 않는다(환산·최소값은 옵션으로 조정)", () => {
    const r = assemblePrompt(card, null, [], hist, "입력", { ...cfg, cacheBreakpoint: true });
    expect(r.cacheBreakpointIndex).toBeNull();
    expect(r.cachePrefixTokens).toBeGreaterThan(0);
    expect(r.messages.some((m) => m.cacheBreakpoint)).toBe(false);
    const forced = assemblePrompt(card, null, [], hist, "입력", { ...cfg, cacheBreakpoint: true, cacheMinTokens: 100 });
    expect(forced.cacheBreakpointIndex).not.toBeNull();
  });
});
