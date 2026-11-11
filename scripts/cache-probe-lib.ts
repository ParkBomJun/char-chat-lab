import { createHash } from "node:crypto";
import type { ChatMessage } from "../src/lib/llm/types";

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);

export type PrefixReport = {
  /** 앞에서부터 완전히 같은 메시지 수 */
  sameMessages: number;
  /** 같은 접두사의 글자 수(메시지 사이 구분 제외, 공통 부분의 content 합 + 마지막 부분 일치분) */
  sameChars: number;
  /** a의 전체 글자 수 */
  totalCharsA: number;
  /** 처음 달라지는 메시지 인덱스. 완전히 같으면 null(= a가 b의 접두사이거나 같음) */
  firstDiffIndex: number | null;
  /** a 전체가 b의 접두사인가 (= 캐시가 이어서 쓸 수 있는 이상적인 경우) */
  aIsPrefixOfB: boolean;
};

const same = (x: ChatMessage, y: ChatMessage) => x.role === y.role && Buffer.from(x.content, "utf8").equals(Buffer.from(y.content, "utf8"));

/** 두 요청의 메시지 배열이 앞에서 어디까지 바이트 단위로 같은지. 제공사 캐시는 이 접두사만 재사용할 수 있다. */
export function comparePrefix(a: readonly ChatMessage[], b: readonly ChatMessage[]): PrefixReport {
  let i = 0;
  let chars = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) {
    chars += a[i].content.length;
    i++;
  }
  const totalCharsA = a.reduce((n, m) => n + m.content.length, 0);
  return { sameMessages: i, sameChars: chars, totalCharsA, firstDiffIndex: i < a.length ? i : null, aIsPrefixOfB: i === a.length && b.length >= a.length };
}

/** 두 문자열의 첫 불일치 위치 주변을 보여 준다(진단 출력용). */
export function firstDiffSnippet(a: string, b: string, around = 24): string {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  if (i === n && a.length === b.length) return "(동일)";
  const cut = (s: string) => JSON.stringify(s.slice(Math.max(0, i - around), i + around));
  return `위치 ${i}: 앞 ${cut(a)} ↔ 뒤 ${cut(b)}`;
}
