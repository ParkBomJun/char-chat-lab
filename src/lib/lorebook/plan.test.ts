import { describe, expect, it } from "vitest";
import haru from "../../../prisma/seed-data/haru.json";
import { assemblePrompt, renderFixedBlock } from "@/lib/chat/assemble";
import { lorebookInlineSize, planLorebook } from "./plan";
import type { LorebookEntryData } from "./match";

const e = (id: string, content: string, priority = 0, enabled = true, keywords = ["정원"]): LorebookEntryData => ({ id, keywords, content, priority, enabled });
const opts = { scanTurns: 4, inlineMaxTokens: 1000 };
const card = { name: "하루", persona: "사서", speechStyle: "해요체", exampleDialog: "사용자: 안녕\n하루: 어서 오세요." };
const cfg = { promptTokenBudget: 100_000, lorebookTokenBudget: 800 };

describe("planLorebook: 작은 로어북은 고정 블록에 상시 포함, 큰 로어북은 키워드 방식", () => {
  it("활성 항목 전체가 기준 이하면 inline: 대화 내용과 무관하게 전부, 순서는 우선순위 → id", () => {
    const entries = [e("b", "둘", 1), e("a", "하나", 1), e("c", "셋", 5), e("d", "꺼진 항목", 9, false)];
    const p = planLorebook(entries, [{ role: "USER", content: "키워드가 전혀 없는 말" }], opts);
    expect(p.mode).toBe("inline");
    expect(p.inline.map((h) => h.id)).toEqual(["c", "a", "b"]); // 비활성 항목은 빠진다
    expect(p.hits).toEqual([]);
    // 입력 순서가 달라도 같은 결과
    expect(planLorebook([...entries].reverse(), [], opts).inline).toEqual(p.inline);
  });

  it("기준을 넘으면 keyword: 지금처럼 키워드가 나온 항목만", () => {
    const entries = [e("a", "가".repeat(600)), e("b", "나".repeat(600), 0, true, ["고양이"])];
    expect(lorebookInlineSize(entries)).toBeGreaterThan(1000);
    const p = planLorebook(entries, [{ role: "USER", content: "정원 얘기 해 줘요" }], opts);
    expect(p.mode).toBe("keyword");
    expect(p.inline).toEqual([]);
    expect(p.hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("기준 경계와 끄기: 딱 기준이면 inline, 0이면 항상 keyword, 활성 항목이 없으면 none", () => {
    const entries = [e("a", "가".repeat(100))];
    const size = lorebookInlineSize(entries);
    expect(planLorebook(entries, [], { scanTurns: 4, inlineMaxTokens: size }).mode).toBe("inline");
    expect(planLorebook(entries, [], { scanTurns: 4, inlineMaxTokens: size - 1 }).mode).toBe("keyword");
    expect(planLorebook(entries, [], { scanTurns: 4, inlineMaxTokens: 0 }).mode).toBe("keyword");
    expect(planLorebook([e("x", "꺼짐", 0, false)], [], opts).mode).toBe("none");
  });

  it("★ 상시 포함이면 고정 블록이 턴마다 바이트 단위로 같다(대화 내용·걸린 키워드와 무관)", () => {
    const entries = [e("l1", "정원에는 라벤더가 있다.", 2), e("l2", "고양이 이름은 책갈피다.", 1, true, ["고양이"])];
    const turns = ["오늘 날씨 좋네요", "정원 얘기 해 줘요", "고양이도 있어요?", "이제 다른 얘기 해요", "정원이랑 고양이 둘 다 좋아요"];
    const history: { role: "USER" | "ASSISTANT"; content: string }[] = [];
    const fixedBlocks: string[] = [];
    for (const input of turns) {
      const p = planLorebook(entries, [...history, { role: "USER", content: input }], opts);
      const a = assemblePrompt(card, null, p.hits, history, input, { ...cfg, fixedLorebook: p.inline, cacheBreakpoint: true, cacheBreakpointPosition: "fixedBlock", cacheMinTokens: 1 });
      fixedBlocks.push(a.messages[0].content);
      expect(a.messages.filter((m) => m.role === "system")).toHaveLength(1); // 로어북이 별도 system 메시지로 나가지 않는다
      expect(a.cacheBreakpointIndex).toBe(0);
      expect(a.lorebookIds).toEqual([]);
      expect(a.inlineLorebookIds).toEqual(["l1", "l2"]);
      history.push({ role: "USER", content: input }, { role: "ASSISTANT", content: `응답 ${history.length}` });
    }
    for (const f of fixedBlocks) expect(Buffer.from(f, "utf8").equals(Buffer.from(fixedBlocks[0], "utf8"))).toBe(true);
    expect(fixedBlocks[0]).toContain("## 참고 설정\n- 정원에는 라벤더가 있다.\n- 고양이 이름은 책갈피다.");
    // 같은 조건에서 키워드 방식이면 걸린 항목이 바뀔 때 system 메시지가 달라진다(대조)
    const k1 = assemblePrompt(card, null, planLorebook(entries, [{ role: "USER", content: turns[0] }], { scanTurns: 4, inlineMaxTokens: 0 }).hits, [], turns[0], cfg);
    const k2 = assemblePrompt(card, null, planLorebook(entries, [{ role: "USER", content: turns[1] }], { scanTurns: 4, inlineMaxTokens: 0 }).hits, [], turns[1], cfg);
    expect(k1.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(k2.messages.filter((m) => m.role === "system")).toHaveLength(2);
  });

  it("관리자가 항목을 고치면 고정 블록이 바뀐다(캐시가 한 번 새로 만들어지는 이유)", () => {
    const before = renderFixedBlock(card, ["정원에는 라벤더가 있다."]);
    const after = renderFixedBlock(card, ["정원에는 로즈마리가 있다."]);
    expect(after).not.toBe(before);
    expect(renderFixedBlock(card, [])).toBe(renderFixedBlock(card)); // 항목이 없으면 예전 고정 블록과 같다
  });

  it("시드 카드 하루의 로어북(4개)은 기본 기준 1000 이하라 상시 포함된다", () => {
    const entries = haru.lorebook.map((l) => ({ id: l.id, keywords: l.keywords, content: l.content, priority: l.priority, enabled: true }));
    expect(lorebookInlineSize(entries)).toBeLessThanOrEqual(1000);
    const p = planLorebook(entries, [], opts);
    expect(p.mode).toBe("inline");
    expect(p.inline).toHaveLength(4);
  });
});
