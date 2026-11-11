import type { LorebookHit } from "@/lib/chat/assemble";
import { MIN_KEYWORD_LENGTH, normalizeForMatch } from "./keywords";

export type LorebookEntryData = {
  id: string;
  keywords: readonly string[];
  content: string;
  priority: number;
  enabled: boolean;
};
export type ScanMessage = { role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE"; content: string };

/** 최근 `turns`턴의 메시지만 남긴다. 한 턴 = USER 메시지로 시작. 안내 메시지는 제외. */
export function lastTurns(messages: readonly ScanMessage[], turns: number): ScanMessage[] {
  const msgs = messages.filter((m) => m.role !== "SYSTEM_NOTICE");
  let seen = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "USER" && ++seen === turns) return msgs.slice(i);
  }
  return msgs; // 턴 수가 모자라면 전부
}

/**
 * 로어북 키워드 매칭 (SPEC 3-4). 순수 함수.
 * - 대상: 최근 M턴의 사용자·캐릭터 메시지(이번 입력 포함해서 넘긴다).
 * - 규칙: 공백 제거·소문자 부분 문자열. 한국어는 조사가 붙으므로 단어 경계를 쓰지 않는다.
 * - 결과 순서: 우선순위 높은 순, 같으면 id 순. 입력 순서와 무관하게 항상 같은 순서여야
 *   로어북 블록 텍스트가 안정적이고 캐시가 불필요하게 깨지지 않는다.
 */
export function matchLorebook(
  entries: readonly LorebookEntryData[],
  messages: readonly ScanMessage[],
  scanTurns: number,
): LorebookHit[] {
  const haystack = normalizeForMatch(lastTurns(messages, scanTurns).map((m) => m.content).join("\n"));
  if (!haystack) return [];

  return entries
    .filter((e) => e.enabled && e.keywords.some((k) => {
      const n = normalizeForMatch(k);
      return n.length >= MIN_KEYWORD_LENGTH && haystack.includes(n);
    }))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, content: e.content, priority: e.priority }));
}
