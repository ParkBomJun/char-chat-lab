import { describe, expect, it } from "vitest";
import haru from "../../../prisma/seed-data/haru.json";
import { characterSchema } from "@/lib/admin/forms";
import { loadConfig } from "@/lib/config";
import { TYPICAL_TURN_CHARS, cardBudgetMessage, cardBudgetStatus } from "./budget";

const lorebook = haru.lorebook.map((l) => ({ id: l.id, keywords: l.keywords, content: l.content, priority: l.priority, enabled: true }));
const defaults = loadConfig({});

/** 관리자 화면이 받는 최대 길이로 채운 카드(한도는 characterSchema에서 읽는다) */
function maxCard() {
  const max = (k: "name" | "persona" | "speechStyle" | "exampleDialog") => "가".repeat(characterSchema.shape[k].maxLength!);
  return { name: max("name"), persona: max("persona"), speechStyle: max("speechStyle"), exampleDialog: max("exampleDialog") };
}
/** 상시 포함 기준(LOREBOOK_INLINE_MAX_TOKENS)을 꽉 채운 로어북: 항목 하나가 "- 내용\n"으로 세어진다 */
const maxInlineLore = [{ id: "l1", keywords: ["키워드"], content: "나".repeat(defaults.lorebookInlineMaxTokens - 3), priority: 0, enabled: true }];

describe("카드와 프롬프트 예산", () => {
  it("기본 설정에서 시드 카드는 여유가 있다", () => {
    const s = cardBudgetStatus(haru.character, lorebook, defaults);
    expect(s.level).toBe("ok");
    expect(s.fixed).toBe(7976);
    expect(cardBudgetMessage(s)).toBeNull();
    // 요약 직전의 원문 30턴(RECENT_TURNS + SUMMARY_EVERY)도 평소 길이면 들어간다
    expect(s.room).toBeGreaterThanOrEqual((defaults.recentTurns + defaults.summaryEvery) * TYPICAL_TURN_CHARS);
  });

  it("기본 설정에서는 관리자 화면 한도를 다 채운 카드도 최근 20턴 몫이 남는다", () => {
    const s = cardBudgetStatus(maxCard(), maxInlineLore, defaults);
    expect(s.fixed).toBeGreaterThan(11_000);
    expect(s.fixed).toBeLessThan(11_500);
    expect(s.level).toBe("ok");
  });

  it("예전 기본값 6000이면 시드 카드는 예산 초과(over)", () => {
    const s = cardBudgetStatus(haru.character, lorebook, { ...defaults, promptTokenBudget: 6000 });
    expect(s.level).toBe("over");
    expect(s.room).toBeLessThan(0);
    expect(cardBudgetMessage(s)).toContain("한 줄도");
  });

  it("남는 몫이 최근 턴의 평소 길이보다 작으면 tight", () => {
    const s = cardBudgetStatus(haru.character, lorebook, { ...defaults, promptTokenBudget: 7976 + defaults.recentTurns * TYPICAL_TURN_CHARS - 1 });
    expect(s.level).toBe("tight");
    expect(cardBudgetMessage(s)).toContain("잘립니다");
    expect(cardBudgetStatus(haru.character, lorebook, { ...defaults, promptTokenBudget: 7976 + defaults.recentTurns * TYPICAL_TURN_CHARS }).level).toBe("ok");
  });

  it("키워드 방식 로어북은 로어북 예산만큼을 미리 뺀다", () => {
    const big = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, keywords: ["키워드"], content: "다".repeat(900), priority: 0, enabled: true }));
    const s = cardBudgetStatus(haru.character, big, defaults);
    expect(s.lorebookReserve).toBe(defaults.lorebookTokenBudget);
    expect(s.room).toBe(defaults.promptTokenBudget - s.fixed - defaults.lorebookTokenBudget);
  });
});
