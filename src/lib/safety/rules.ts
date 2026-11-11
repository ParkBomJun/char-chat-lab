import rulesFile from "@/config/safety-rules.json";

export type RuleTarget = "input" | "output";
export type RuleKind = "block" | "crisis";
/** hard: 바로 차단·위기 안내 / soft: 차단하지 않고 분류기에 힌트만 전달 */
export type RuleTier = "hard" | "soft";

export type RuleDef = {
  category: string;
  kind: RuleKind;
  /** 없으면 hard */
  tier?: RuleTier;
  appliesTo: RuleTarget[];
  spaced?: boolean;
  words?: string[];
  regex?: string[];
};
export type CompiledRule = {
  category: string;
  kind: RuleKind;
  tier: RuleTier;
  appliesTo: RuleTarget[];
  patterns: RegExp[];
  /** 깊은 정규화(공백·기호 제거 등)된 글에 맞추는 패턴. 공백이 사라졌으므로 \s+는 \s*로, 단어 경계(\b)는 뺀다 */
  deepPatterns: RegExp[];
};

/** HARD 판정(차단·위기 안내). 기존 호출부와 같은 모양이다. */
export type RuleResult = { kind: "none" } | { kind: RuleKind; category: string };
/** SOFT 힌트 1건. normalizedOnly는 원문에서는 안 걸리고 깊은 정규화를 거쳐야만 걸린 경우 */
export type SoftHit = { kind: RuleKind; category: string; normalizedOnly: boolean };
export type RuleEvaluation = { hard: { kind: RuleKind; category: string } | null; soft: SoftHit[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 규칙 검사용 정규화: NFC, 소문자, 제로폭 문자 제거, 공백은 하나로. */
export function normalizeForRules(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ");
}

// ── 깊은 정규화 ──────────────────────────────────────────────────────────────
const CHO = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const JUNG = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const isSyllable = (ch: string | undefined) => ch !== undefined && ch >= "가" && ch <= "힣";

/** 풀어 쓴 낱자(ㅈㅏㅅㅏㄹ)를 음절(자살)로 합친다. 초성만 있는 표기(ㅈㅅ)는 복원할 수 없어 그대로 둔다. */
export function composeJamo(text: string): string {
  const cs = [...text];
  let out = "";
  for (let i = 0; i < cs.length; i++) {
    const cho = CHO.indexOf(cs[i]);
    const jung = i + 1 < cs.length ? JUNG.indexOf(cs[i + 1]) : -1;
    if (cho === -1 || jung === -1) {
      out += cs[i];
      continue;
    }
    let jong = 0;
    // 다음 낱자가 받침이 될 수 있고, 그 뒤가 모음이 아니면 받침으로 붙인다(뒤가 모음이면 다음 음절의 초성이다)
    const j = i + 2 < cs.length ? JONG.indexOf(cs[i + 2]) : -1;
    if (j > 0 && !(i + 3 < cs.length && JUNG.includes(cs[i + 3]))) jong = j;
    out += String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong);
    i += jong ? 2 : 1;
  }
  return out;
}

/** 영문 속 숫자 치환(t3st → test) */
const LEET_LATIN: Record<string, string> = { "4": "a", "3": "e", "1": "i", "0": "o", "5": "s", "7": "t", "8": "b", "9": "g" };
/** 한글 사이에 낀 숫자·영문 한 글자를 소리가 같은 음절로(2야기 → 이야기, g시 → 지시) */
const LEET_HANGUL: Record<string, string> = {
  "2": "이", "1": "일", "3": "삼", "4": "사", "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구", "0": "영",
  e: "에", a: "아", b: "비", c: "씨", d: "디", g: "지", k: "케", l: "엘", m: "엠", n: "엔", p: "피", q: "큐", r: "알", t: "티", u: "유",
};

/** 숫자·영문 치환 복원. 한글 음절과 맞닿은 숫자·영문 한 글자는 음절로, 영문 단어 속 숫자는 영문자로 되돌린다. */
export function restoreLeet(text: string): string {
  const cs = [...text];
  const isLatin = (ch: string | undefined) => ch !== undefined && /[a-z]/.test(ch);
  return cs
    .map((ch, i) => {
      const prev = cs[i - 1];
      const next = cs[i + 1];
      if (/[0-9]/.test(ch)) {
        if (isSyllable(prev) || isSyllable(next)) return LEET_HANGUL[ch] ?? ch;
        if (isLatin(prev) || isLatin(next)) return LEET_LATIN[ch] ?? ch;
        return ch;
      }
      // 영문 한 글자가 한글 사이·옆에 홀로 끼어 있을 때만(영어 단어는 건드리지 않는다)
      if (isLatin(ch) && !isLatin(prev) && !isLatin(next) && (isSyllable(prev) || isSyllable(next))) return LEET_HANGUL[ch] ?? ch;
      return ch;
    })
    .join("");
}

/**
 * 깊은 정규화: 공백·특수문자 제거 → 자모 결합 → 3번 이상 반복된 글자 접기. 두 번째 값은 거기에 숫자·영문 치환까지 복원한 것.
 * 복원은 틀릴 수 있으므로(숫자가 진짜 숫자일 수 있다) 두 형태를 모두 검사한다.
 */
export function deepNormalize(text: string): [string, string] {
  const stripped = normalizeForRules(text).replace(/[^\p{L}\p{N}]/gu, "");
  const base = composeJamo(stripped).replace(/(.)\1{2,}/gu, "$1");
  return [base, restoreLeet(base).replace(/(.)\1{2,}/gu, "$1")];
}

export function compileRules(defs: readonly RuleDef[]): CompiledRule[] {
  return defs.map((d) => {
    const patterns: RegExp[] = [];
    const deepPatterns: RegExp[] = [];
    for (const w of d.words ?? []) {
      const chars = [...w.toLowerCase()];
      // 공백 허용은 3글자 이상 단어에만: "죽고 싶다"는 잡아야 하지만, 2글자 단어에 허용하면
      // "사자 살았다"의 "자 살"처럼 서로 다른 단어 사이가 걸린다. 띄어 쓴 2글자는 깊은 정규화가 SOFT 힌트로만 잡는다.
      const src = d.spaced && chars.length >= 3 ? chars.map(escapeRe).join("\\s*") : escapeRe(w.toLowerCase());
      patterns.push(new RegExp(src, "u"));
      deepPatterns.push(new RegExp(escapeRe(w.toLowerCase()), "u"));
    }
    for (const r of d.regex ?? []) {
      patterns.push(new RegExp(r, "iu"));
      deepPatterns.push(new RegExp(r.replace(/\\s\+/g, "\\s*").replace(/\\b/g, ""), "iu"));
    }
    return { category: d.category, kind: d.kind, tier: d.tier ?? "hard", appliesTo: d.appliesTo, patterns, deepPatterns };
  });
}

export const defaultRules: CompiledRule[] = compileRules(rulesFile.rules as RuleDef[]);

/**
 * 규칙 층 평가.
 *  1) 원문(가벼운 정규화)에 hard 규칙 → 바로 차단·위기 안내. 위기 표현은 차단보다 우선한다(사용자 보호가 먼저).
 *  2) 원문에 soft 규칙 → 힌트.
 *  3) 깊은 정규화한 글에 모든 규칙(hard 포함)을 다시 맞춰 보고, 원문에서는 안 걸린 것만 힌트로 추가한다.
 *     정규화는 서로 다른 단어를 붙여 버려 오탐이 생길 수 있으므로("피자 살까" → "자살") 절대 바로 차단하지 않는다.
 * 출력에는 위기 규칙을 쓰지 않는다: 캐릭터가 위로하며 "자살"을 언급하는 정상 응답을 회수하지 않기 위해.
 */
export function evaluateRules(text: string, target: RuleTarget, rules: readonly CompiledRule[] = defaultRules): RuleEvaluation {
  const t = normalizeForRules(text);
  const applicable = rules.filter((r) => r.appliesTo.includes(target));
  const rawHit = new Set<CompiledRule>(applicable.filter((r) => r.patterns.some((p) => p.test(t))));

  let hard: RuleEvaluation["hard"] = null;
  for (const kind of ["crisis", "block"] as const) {
    const r = applicable.find((x) => x.tier === "hard" && x.kind === kind && rawHit.has(x));
    if (r) {
      hard = { kind, category: r.category };
      break;
    }
  }

  const soft: SoftHit[] = [];
  const add = (r: CompiledRule, normalizedOnly: boolean) => {
    const i = soft.findIndex((s) => s.kind === r.kind && s.category === r.category);
    if (i === -1) soft.push({ kind: r.kind, category: r.category, normalizedOnly });
    else if (!normalizedOnly) soft[i].normalizedOnly = false; // 원문에서도 걸렸다면 그쪽이 우선
  };
  for (const r of applicable) if (r.tier === "soft" && rawHit.has(r)) add(r, false);
  // hard로 이미 막힌 글은 더 볼 필요가 없다(힌트를 받을 분류기 호출이 없다)
  if (!hard) {
    const deep = deepNormalize(text);
    for (const r of applicable) {
      if (rawHit.has(r)) continue;
      if (r.deepPatterns.some((p) => deep.some((d) => p.test(d)))) add(r, true);
    }
  }
  return { hard, soft };
}

/** HARD 판정만 돌려준다(스트리밍 중 검사처럼 차단 여부만 필요할 때). */
export function checkRules(text: string, target: RuleTarget, rules: readonly CompiledRule[] = defaultRules): RuleResult {
  const t = normalizeForRules(text);
  const applicable = rules.filter((r) => r.tier === "hard" && r.appliesTo.includes(target));
  for (const kind of ["crisis", "block"] as const) {
    for (const r of applicable) {
      if (r.kind === kind && r.patterns.some((p) => p.test(t))) return { kind, category: r.category };
    }
  }
  return { kind: "none" };
}

/** 규칙 범주 → 분류기 프롬프트에 쓰는 범주 이름(분류기의 카테고리 어휘에 맞춘다) */
export const hintCategory = (s: Pick<SoftHit, "kind" | "category">): string => (s.kind === "crisis" ? "self_harm" : s.category);
