import type { LorebookHit } from "@/lib/chat/assemble";
import { estimateTokens } from "@/lib/tokens";
import { matchLorebook, type LorebookEntryData, type ScanMessage } from "./match";

/**
 * 로어북을 프롬프트에 넣는 방식 결정(순수 함수). 서비스 라우트와 평가 엔진이 같이 쓴다.
 *  - inline: 활성 항목 전체가 작으면(추정 토큰 ≤ inlineMaxTokens) 고정 블록 안에 **상시 포함**한다.
 *    대화 내용과 무관하게 항상 같은 내용이 들어가므로 고정 블록이 턴마다 바이트 단위로 같고, 캐시가 다시 만들어지지 않는다.
 *  - keyword: 그보다 크면 지금처럼 최근 대화에 키워드가 나온 항목만 따로 넣는다(걸린 항목이 바뀌면 캐시 앞부분이 달라진다).
 * 실측 근거와 한계는 docs/CACHE.md.
 */
export type LorebookPlan = { mode: "inline" | "keyword" | "none"; inline: LorebookHit[]; hits: LorebookHit[] };

/** 항목 순서를 고정한다: 우선순위 높은 순, 같으면 id 순. DB가 돌려주는 순서와 무관하게 항상 같은 글이 나오게 한다. */
const stableOrder = (a: LorebookEntryData, b: LorebookEntryData) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 상시 포함 여부를 가르는 크기: 활성 항목 본문의 추정 토큰 합(항목마다 목록 기호와 줄바꿈 포함) */
export function lorebookInlineSize(entries: readonly LorebookEntryData[]): number {
  return entries.filter((e) => e.enabled).reduce((n, e) => n + estimateTokens(`- ${e.content}\n`), 0);
}

export function planLorebook(
  entries: readonly LorebookEntryData[],
  messages: readonly ScanMessage[],
  opts: { scanTurns: number; inlineMaxTokens: number },
): LorebookPlan {
  const enabled = entries.filter((e) => e.enabled);
  if (enabled.length === 0) return { mode: "none", inline: [], hits: [] };
  if (opts.inlineMaxTokens > 0 && lorebookInlineSize(enabled) <= opts.inlineMaxTokens) {
    return { mode: "inline", inline: [...enabled].sort(stableOrder).map((e) => ({ id: e.id, content: e.content, priority: e.priority })), hits: [] };
  }
  return { mode: "keyword", inline: [], hits: matchLorebook(entries, messages, opts.scanTurns) };
}
