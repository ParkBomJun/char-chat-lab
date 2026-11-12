import { z } from "zod";

/** 빈 문자열(.env의 `KEY=`)은 "설정 안 함"으로 취급해 기본값을 쓴다. */
const num = (def: number, min = 0) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(min).default(def));

const flt = (def: number) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().min(0).max(1).default(def));

const schema = z.object({
  RECENT_TURNS: num(20, 1),
  SUMMARY_EVERY: num(10, 1),
  LOREBOOK_SCAN_TURNS: num(4, 1),
  LOREBOOK_INLINE_MAX_TOKENS: num(1000, 0),
  DAILY_MESSAGE_LIMIT: num(50, 1),
  PROMPT_TOKEN_BUDGET: num(6000, 500),
  LOREBOOK_TOKEN_BUDGET: num(800, 0),
  MAX_OUTPUT_TOKENS: num(1024, 16),
  CLASSIFIER_BLOCK_THRESHOLD: flt(0.8),
  CLASSIFIER_TIMEOUT_MS: num(8000, 500),
  CLASSIFIER_RETRIES: num(1, 0),
  CLASSIFIER_RETRY_DELAY_MS: num(300, 0),
  FLOW_WINDOW_TURNS: num(5, 1),
  FLOW_MIN_TURNS: num(2, 1),
  FLOW_WARN_THRESHOLD: flt(0.5),
  FLOW_STOP_STRIKES: num(2, 1),
  QUALITY_MIN_HANGUL_RATIO: flt(0.9),
  CACHE_BREAKPOINT: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["0", "1", "true", "false"]).default("1")),
  CACHE_MIN_TOKENS: num(3500, 1),
  CACHE_BREAKPOINT_POSITION: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["beforeInput", "fixedBlock", "stepped"]).default("fixedBlock")),
  CACHE_STEP_TOKENS: num(1500, 1),
  LOREBOOK_POSITION: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["afterFixed", "beforeInput"]).default("afterFixed")),
});

export type AppConfig = {
  recentTurns: number;
  summaryEvery: number;
  lorebookScanTurns: number;
  /** 활성 로어북 전체의 추정 토큰이 이 값 이하면 고정 블록에 상시 포함한다. 0이면 항상 키워드 방식 */
  lorebookInlineMaxTokens: number;
  dailyMessageLimit: number;
  promptTokenBudget: number;
  lorebookTokenBudget: number;
  maxOutputTokens: number;
  /** 분류기 score가 이 값 이상이면 verdict와 무관하게 차단 */
  classifierBlockThreshold: number;
  classifierTimeoutMs: number;
  classifierRetries: number;
  classifierRetryDelayMs: number;
  /** 캐시 실험 옵션(E6 결과를 보고 기본값을 정한다). 기본: breakpoint 켬(E6 실측 후 결정, 2026-11-11), 로어북은 고정 블록 뒤 */
  cache: { breakpoint: boolean; minTokens: number; breakpointPosition: "beforeInput" | "fixedBlock" | "stepped"; stepTokens: number; lorebookPosition: "afterFixed" | "beforeInput" };
  flow: { windowTurns: number; minTurns: number; warnThreshold: number; stopStrikes: number };
  /** 응답 품질 지표의 표시 기준(기록·표시용, 차단에 쓰지 않는다): 한글 비율이 이 값 미만이면 '외국어 섞임'으로 센다 */
  quality: { minHangulRatio: number };
};

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const e = schema.parse(env);
  return {
    recentTurns: e.RECENT_TURNS,
    summaryEvery: e.SUMMARY_EVERY,
    lorebookScanTurns: e.LOREBOOK_SCAN_TURNS,
    lorebookInlineMaxTokens: e.LOREBOOK_INLINE_MAX_TOKENS,
    dailyMessageLimit: e.DAILY_MESSAGE_LIMIT,
    promptTokenBudget: e.PROMPT_TOKEN_BUDGET,
    lorebookTokenBudget: e.LOREBOOK_TOKEN_BUDGET,
    maxOutputTokens: e.MAX_OUTPUT_TOKENS,
    classifierBlockThreshold: e.CLASSIFIER_BLOCK_THRESHOLD,
    classifierTimeoutMs: e.CLASSIFIER_TIMEOUT_MS,
    classifierRetries: Math.min(e.CLASSIFIER_RETRIES, 2),
    classifierRetryDelayMs: Math.min(e.CLASSIFIER_RETRY_DELAY_MS, 5000),
    cache: { breakpoint: e.CACHE_BREAKPOINT === "1" || e.CACHE_BREAKPOINT === "true", minTokens: e.CACHE_MIN_TOKENS, lorebookPosition: e.LOREBOOK_POSITION, breakpointPosition: e.CACHE_BREAKPOINT_POSITION, stepTokens: e.CACHE_STEP_TOKENS },
    quality: { minHangulRatio: e.QUALITY_MIN_HANGUL_RATIO },
    flow: {
      windowTurns: e.FLOW_WINDOW_TURNS,
      minTurns: e.FLOW_MIN_TURNS,
      warnThreshold: e.FLOW_WARN_THRESHOLD,
      stopStrikes: e.FLOW_STOP_STRIKES,
    },
  };
}
