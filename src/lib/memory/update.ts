import type { ChatMessage, Usage } from "@/lib/llm/types";
import { planSummarization } from "./plan";
import { buildSummaryPrompt, SUMMARY_MAX_CHARS, type SummarySourceMessage } from "./prompt";

export type SummaryState = {
  characterName: string;
  previous: { content: string; version: number; coversUntilMsg: string } | null;
  /** 이전 요약이 덮지 않은 메시지(시간순, 회수된 메시지 제외) */
  messages: (SummarySourceMessage & { id: string })[];
};

export type SummaryDeps = {
  load(): Promise<SummaryState | null>;
  summarize(messages: ChatMessage[]): Promise<{ text: string; usage: Usage | null; totalMs: number }>;
  /** 요약 호출 비용 기록(저장 성공 여부와 무관하게 호출은 이미 일어났다) */
  logUsage(info: { usage: Usage | null; outputText: string; totalMs: number }): Promise<void>;
  /** 새 버전 저장. 같은 버전이 이미 있으면(동시 갱신) false */
  save(row: { content: string; coversUntilMsg: string; version: number }): Promise<boolean>;
};

export type SummaryOutcome =
  | { updated: false; reason: "not-needed" | "empty-output" | "conflict" | "no-state" }
  | { updated: true; version: number; summarizedMessages: number };

/**
 * 요약 갱신 한 번 (SPEC 3-3). 응답을 보낸 뒤 비동기로 호출한다.
 * 갱신이 필요 없으면 LLM을 부르지 않는다.
 */
export async function runSummaryUpdate(
  deps: SummaryDeps,
  cfg: { recentTurns: number; summaryEvery: number },
): Promise<SummaryOutcome> {
  const state = await deps.load();
  if (!state) return { updated: false, reason: "no-state" };

  const plan = planSummarization(state.messages, cfg);
  if (!plan) return { updated: false, reason: "not-needed" };

  const ids = new Set(plan.toSummarize.map((m) => m.id));
  const source = state.messages.filter((m) => ids.has(m.id));
  const prompt = buildSummaryPrompt(state.previous?.content ?? null, source, state.characterName);

  const { text, usage, totalMs } = await deps.summarize(prompt);
  await deps.logUsage({ usage, outputText: text, totalMs });

  const content = text.trim().slice(0, SUMMARY_MAX_CHARS * 2); // 모델이 규칙을 어겨도 무한히 커지지 않게 상한
  if (!content) return { updated: false, reason: "empty-output" };

  const version = (state.previous?.version ?? 0) + 1;
  const saved = await deps.save({ content, coversUntilMsg: plan.coversUntilMsg, version });
  if (!saved) return { updated: false, reason: "conflict" };
  return { updated: true, version, summarizedMessages: source.length };
}
