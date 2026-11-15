import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import haru from "../../../prisma/seed-data/haru.json";
import { loadConfig } from "@/lib/config";
import { planLorebook } from "@/lib/lorebook/plan";
import { assemblePrompt, type HistoryMessage } from "./assemble";

/**
 * 실제 시드 카드 + 설정 기본값으로 조립한다.
 * 다른 테스트와 scripts/cache-*.ts는 예산을 100,000으로 줘서, 기본 예산이 카드보다 작아 최근 대화가 전부 잘리는 문제를 잡지 못했다(2026-11-15 발견).
 * 여기서는 예산을 따로 주지 않고 loadConfig의 기본값을 그대로 쓴다.
 */
const lorebook = haru.lorebook.map((l) => ({ id: l.id, keywords: l.keywords, content: l.content, priority: l.priority, enabled: true }));

function assembleWith(env: Record<string, string | undefined>, history: HistoryMessage[], input: string) {
  const config = loadConfig(env);
  const plan = planLorebook(lorebook, [...history, { role: "USER", content: input }], { scanTurns: config.lorebookScanTurns, inlineMaxTokens: config.lorebookInlineMaxTokens });
  return assemblePrompt(haru.character, null, plan.hits, history, input, {
    promptTokenBudget: config.promptTokenBudget,
    lorebookTokenBudget: config.lorebookTokenBudget,
    lorebookPosition: config.cache.lorebookPosition,
    fixedLorebook: plan.inline,
    cacheBreakpoint: config.cache.breakpoint,
    cacheMinTokens: config.cache.minTokens,
    cacheBreakpointPosition: config.cache.breakpointPosition,
    cacheStepTokens: config.cache.stepTokens,
  });
}

/** 첫 인사 + n턴(입력 40자, 응답 360자: 개발 DB에서 잰 길이의 95번째 백분위 근처) */
function turns(n: number, userChars = 40, replyChars = 360): HistoryMessage[] {
  const h: HistoryMessage[] = [{ role: "ASSISTANT", content: haru.character.greeting }];
  for (let i = 0; i < n; i++) {
    h.push({ role: "USER", content: `${i}`.padEnd(userChars, "가") });
    h.push({ role: "ASSISTANT", content: `${i}`.padEnd(replyChars, "나") });
  }
  return h;
}

describe("기본 설정 + 실제 시드 카드", () => {
  it("첫 턴: 첫 인사가 프롬프트에 들어간다", () => {
    const r = assembleWith({}, turns(0), "안녕하세요");
    expect(r.droppedRecent).toBe(0);
    expect(r.overBudget).toBe(false);
    expect(r.messages.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
  });

  it("4턴째: 앞의 3턴과 첫 인사가 전부 들어간다", () => {
    const history = turns(3);
    const r = assembleWith({}, history, "네 번째 입력");
    expect(r.droppedRecent).toBe(0);
    expect(r.overBudget).toBe(false);
    expect(r.messages).toHaveLength(1 + history.length + 1);
    expect(r.blockTokens.recent).toBe(history.reduce((n, m) => n + m.content.length, 0));
  });

  it("요약 직전(원문 RECENT_TURNS + SUMMARY_EVERY턴)에도 평균 길이의 대화는 잘리지 않는다", () => {
    const config = loadConfig({});
    // 입력 40자 + 응답 200자: 실측 평균(응답 187~196자)보다 조금 길게
    const r = assembleWith({}, turns(config.recentTurns + config.summaryEvery, 40, 200), "다음 입력");
    expect(r.droppedRecent).toBe(0);
  });

  it(".env.example의 예산은 코드 기본값과 같다", () => {
    const example = dotenv.parse(readFileSync(path.resolve(__dirname, "../../../.env.example")));
    expect(loadConfig(example).promptTokenBudget).toBe(loadConfig({}).promptTokenBudget);
  });
});
