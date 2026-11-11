import { createHash } from "node:crypto";

/**
 * 캐시 접두사 진단. 캐시는 프롬프트 앞부분이 바이트 단위로 같아야 이어지는데, cached 토큰 수만으로는
 * 적중이 안 됐을 때 "어느 블록이 바뀌어서"인지 알 수 없다. 블록별 해시를 턴마다 남기고 직전 턴과 비교한다.
 * 원문은 저장하지 않는다(짧은 해시만). 순수 함수.
 */
export type PrefixHashes = {
  fixed: string;
  /** 요약 블록이 없으면 null */
  summary: string | null;
  /** 이번 턴에 들어간 로어북 블록. 없으면 null */
  lorebook: string | null;
  /** 프롬프트에 실린 최근 대화의 첫 메시지(시작점). 최근 대화가 없으면 null */
  recentHead: string | null;
  /** 로어북 위치. beforeInput이면 로어북은 접두사 밖이라 바뀌어도 캐시를 깨지 않는다 */
  lorePos: "afterFixed" | "beforeInput";
};

/**
 * 직전 턴 대비 접두사가 처음 달라진 블록(프롬프트 순서로 가장 앞의 것).
 *  first: 비교할 직전 턴이 없음 / none: 접두사 유지(뒤에 덧붙기만 함)
 *  fixed: 캐릭터 카드·안전 지시 변경 / summary: 요약 갱신 / lorebook: 걸린 로어북 변동
 *  recent_window: 최근 대화 시작점 이동(요약이 앞부분을 덮었거나 예산 초과로 오래된 메시지가 잘림)
 *  layout: 로어북 위치 설정이 바뀜
 */
export type CacheBreak = "first" | "none" | "fixed" | "summary" | "lorebook" | "recent_window" | "layout";

/** SHA-256 앞 12자리(48비트). 같은지 다른지만 보면 되므로 짧게 둔다. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

export function diagnoseCacheBreak(prev: PrefixHashes | null, cur: PrefixHashes): CacheBreak {
  if (!prev) return "first";
  if (prev.fixed !== cur.fixed) return "fixed";
  if (prev.summary !== cur.summary) return "summary";
  if (prev.lorePos !== cur.lorePos) return "layout";
  if (cur.lorePos === "afterFixed" && prev.lorebook !== cur.lorebook) return "lorebook";
  // 직전 턴에 최근 대화가 없었다면(첫 턴) 이번에 생긴 시작점은 덧붙은 것이지 이동이 아니다.
  if (prev.recentHead !== null && prev.recentHead !== cur.recentHead) return "recent_window";
  return "none";
}

const HASH = /^[0-9a-f]{12}$/;
const hashOrNull = (v: unknown): v is string | null => v === null || (typeof v === "string" && HASH.test(v));

/** DB에서 읽은 JSON(UsageLog.blockTokens.prefix)을 검증해 돌려준다. 형식이 다르면 null(이전 버전 행 등). */
export function readPrefixHashes(json: unknown): PrefixHashes | null {
  const p = (json as { prefix?: unknown } | null)?.prefix as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object") return null;
  if (typeof p.fixed !== "string" || !HASH.test(p.fixed)) return null;
  if (!hashOrNull(p.summary) || !hashOrNull(p.lorebook) || !hashOrNull(p.recentHead)) return null;
  if (p.lorePos !== "afterFixed" && p.lorePos !== "beforeInput") return null;
  return { fixed: p.fixed, summary: p.summary, lorebook: p.lorebook, recentHead: p.recentHead, lorePos: p.lorePos };
}
