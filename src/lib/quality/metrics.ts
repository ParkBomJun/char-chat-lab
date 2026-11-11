/**
 * 응답 품질 지표. 모델 호출 없이 글자만 보고 계산한다(순수 함수).
 * 기록용이다: 이 값으로 응답을 차단하거나 다시 만들지 않는다.
 */
export type ResponseQuality = {
  /** 글자(공백·문장부호·숫자·기호·이모지 제외) 중 한글의 비율. 글자가 하나도 없으면 null */
  hangulRatio: number | null;
  /** 한글·라틴 외 문자의 종류(han=한자, kana=가나, cyrillic=키릴, …). 없으면 빈 배열 */
  foreignScripts: string[];
  /** 괄호 안 문구(행동 묘사). 앞뒤 공백을 지운 것, 나온 순서대로(중복 포함) */
  actionPhrases: string[];
  /** 글자 수(공백 포함, 코드포인트 기준) */
  length: number;
  /** 문단 수: 줄바꿈으로 나뉜 비어 있지 않은 덩어리 */
  paragraphs: number;
  /** 끝이 물음표인가(뒤따르는 따옴표·괄호·공백·이모지는 무시) */
  endsWithQuestion: boolean;
};

const LETTER = /\p{L}/u;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/u;
/** 한글·라틴 외 문자 체계. 앞에서부터 처음 맞는 이름을 쓴다 */
const SCRIPTS: [string, RegExp][] = [
  ["han", /\p{Script=Han}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["thai", /\p{Script=Thai}/u],
  ["greek", /\p{Script=Greek}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
];
export const SCRIPT_LABEL: Record<string, string> = { han: "한자", kana: "가나", cyrillic: "키릴", arabic: "아랍", thai: "태국", greek: "그리스", devanagari: "데바나가리", hebrew: "히브리", other: "기타" };

/** 괄호(반각·전각) 안의 한 줄짜리 문구. 중첩 괄호는 안쪽 것만 잡는다 */
const PAREN = /[(（]([^()（）\n]{1,80})[)）]/g;
const MAX_PHRASES = 20;

export function computeResponseQuality(text: string): ResponseQuality {
  let letters = 0;
  let hangul = 0;
  const foreign = new Set<string>();
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (HANGUL.test(ch)) hangul++;
    else if (!LATIN.test(ch)) foreign.add(SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? "other");
  }
  const actionPhrases = [...text.matchAll(PAREN)].map((m) => m[1].trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, MAX_PHRASES);
  // 끝의 닫는 따옴표·괄호·별표·공백·이모지를 걷어 내고 마지막 글자를 본다
  const tail = text.replace(/[\s"'”’」』)）\]*~\p{Extended_Pictographic}️]+$/u, "");
  return {
    hangulRatio: letters ? hangul / letters : null,
    foreignScripts: [...foreign].sort(),
    actionPhrases,
    length: [...text].length,
    paragraphs: text.split(/\n+/).filter((p) => p.trim() !== "").length,
    endsWithQuestion: /[?？]$/.test(tail),
  };
}
