import { z } from "zod";

/** 빈 문자열(.env의 `KEY=`)은 "설정 안 함"으로 취급해 기본값을 쓴다. */
const num = (def: number, min = 0) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(min).default(def));

const schema = z.object({
  RECENT_TURNS: num(20, 1),
  SUMMARY_EVERY: num(10, 1),
  LOREBOOK_SCAN_TURNS: num(4, 1),
  DAILY_MESSAGE_LIMIT: num(50, 1),
  PROMPT_TOKEN_BUDGET: num(6000, 500),
  LOREBOOK_TOKEN_BUDGET: num(800, 0),
  MAX_OUTPUT_TOKENS: num(1024, 16),
});

export type AppConfig = {
  recentTurns: number;
  summaryEvery: number;
  lorebookScanTurns: number;
  dailyMessageLimit: number;
  promptTokenBudget: number;
  lorebookTokenBudget: number;
  maxOutputTokens: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const e = schema.parse(env);
  return {
    recentTurns: e.RECENT_TURNS,
    summaryEvery: e.SUMMARY_EVERY,
    lorebookScanTurns: e.LOREBOOK_SCAN_TURNS,
    dailyMessageLimit: e.DAILY_MESSAGE_LIMIT,
    promptTokenBudget: e.PROMPT_TOKEN_BUDGET,
    lorebookTokenBudget: e.LOREBOOK_TOKEN_BUDGET,
    maxOutputTokens: e.MAX_OUTPUT_TOKENS,
  };
}
