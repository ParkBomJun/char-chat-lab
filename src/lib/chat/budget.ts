import type { LorebookEntryData } from "@/lib/lorebook/match";
import { planLorebook } from "@/lib/lorebook/plan";
import { estimateTokens } from "@/lib/tokens";
import { renderFixedBlock, type CharacterCard } from "./assemble";

/**
 * 카드 크기와 프롬프트 예산의 관계 점검(순수 함수). 관리자 화면 저장, predeploy, 테스트가 같이 쓴다.
 *
 * 배경(2026-11-15): 조립기는 고정 블록을 자르지 않고 남는 예산만 최근 대화에 준다. 카드가 예산보다 커지면
 * 최근 대화가 조용히 전부 잘린다(오류도 경고도 없었다). 그래서 카드가 예산에 비해 큰지를 저장·배포 시점에 알린다.
 *
 * 단위는 조립기와 같은 "추정 토큰 = 글자 수"(estimateTokens)다. 실제 토큰은 약 0.55배.
 */

/**
 * 대화 한 턴(사용자 입력 + 응답)의 평소 길이(글자 수). "최근 대화 몫이 충분한가"의 기준에만 쓴다.
 * 근거: 개발 DB 응답 평균 187자(95번째 백분위 356자), 평가 실행 57턴 평균 196자, 입력 평균 20자(2026-11-15 조회). 여유를 두어 250.
 */
export const TYPICAL_TURN_CHARS = 250;

export type BudgetCheckConfig = {
  promptTokenBudget: number;
  recentTurns: number;
  lorebookInlineMaxTokens: number;
  lorebookTokenBudget: number;
  lorebookScanTurns: number;
};

export type CardBudgetStatus = {
  /**
   * over: 고정 블록(과 키워드 로어북 몫)만으로 예산을 넘는다 → 최근 대화가 하나도 들어가지 않는다.
   * tight: 남는 몫이 최근 recentTurns턴의 평소 길이(recentTurns × TYPICAL_TURN_CHARS)보다 작다 → 대화가 길어지면 요약 전에 잘린다.
   */
  level: "ok" | "tight" | "over";
  /** 고정 블록 추정 토큰(상시 포함 로어북 포함) */
  fixed: number;
  /** 키워드 방식일 때 로어북 블록이 최대로 쓰는 몫(상시 포함·없음이면 0) */
  lorebookReserve: number;
  /** 최근 대화와 이번 입력에 남는 몫(음수일 수 있다) */
  room: number;
  /** tight 기준: recentTurns × TYPICAL_TURN_CHARS */
  needed: number;
  budget: number;
};

export function cardBudgetStatus(card: CharacterCard, lorebook: readonly LorebookEntryData[], cfg: BudgetCheckConfig): CardBudgetStatus {
  const plan = planLorebook(lorebook, [], { scanTurns: cfg.lorebookScanTurns, inlineMaxTokens: cfg.lorebookInlineMaxTokens });
  const fixed = estimateTokens(renderFixedBlock(card, plan.inline.map((h) => h.content)));
  const lorebookReserve = plan.mode === "keyword" ? cfg.lorebookTokenBudget : 0;
  const room = cfg.promptTokenBudget - fixed - lorebookReserve;
  const needed = cfg.recentTurns * TYPICAL_TURN_CHARS;
  return { level: room <= 0 ? "over" : room < needed ? "tight" : "ok", fixed, lorebookReserve, room, needed, budget: cfg.promptTokenBudget };
}

const n = (x: number) => x.toLocaleString("ko-KR");

/** 관리자 화면과 predeploy가 같이 쓰는 안내 문구. ok면 null */
export function cardBudgetMessage(s: CardBudgetStatus): string | null {
  if (s.level === "ok") return null;
  const parts = `고정 블록 ${n(s.fixed)}${s.lorebookReserve ? ` + 키워드 로어북 몫 ${n(s.lorebookReserve)}` : ""}, 프롬프트 예산(PROMPT_TOKEN_BUDGET) ${n(s.budget)}`;
  if (s.level === "over") {
    return `카드가 프롬프트 예산을 넘습니다(${parts}, 글자 수 기준). 이 상태로는 최근 대화가 한 줄도 모델에 가지 않습니다. 카드를 줄이거나 예산을 올리세요.`;
  }
  return `카드에 비해 프롬프트 예산이 작습니다(${parts}, 글자 수 기준). 최근 대화에 남는 몫이 ${n(s.room)}으로, 최근 ${s.needed / TYPICAL_TURN_CHARS}턴의 평소 길이(${n(s.needed)})보다 작아 대화가 길어지면 오래된 턴부터 잘립니다. 카드를 줄이거나 예산을 올리세요.`;
}
