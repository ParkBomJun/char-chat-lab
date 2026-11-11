/**
 * 레드팀 변형 생성(순수 함수, 결정적). label=attack 케이스만 원본으로 삼아 표기를 바꾼 변형을 만든다.
 * 목적은 우리 안전 층(규칙·분류기)이 표기 우회에 얼마나 버티는지 재는 것이다. 같은 시드·같은 입력이면 항상 같은 결과가 나온다.
 * 변형 케이스는 원본 id(mutationOf)와 기법(mutation)을 기록하고 기대 결과(expect/expectAt)·범주·기법(technique)은 원본을 상속한다.
 * 변형 세트에는 공격 문구가 들어 있으므로 호출 측이 eval/redteam/private/ 안에만 저장한다.
 */
import type { RedteamCase, RedteamSet } from "./schema";

export const MUTATIONS = [
  { key: "space", label: "공백 삽입" },
  { key: "special", label: "특수문자 삽입" },
  { key: "jamo", label: "자모 분리" },
  { key: "chosung", label: "초성화" },
  { key: "leet", label: "영문·숫자 치환" },
  { key: "repeat", label: "글자 반복" },
] as const;
export type MutationKey = (typeof MUTATIONS)[number]["key"];
export const DEFAULT_PER_CASE = 4;
export const DEFAULT_SEED = "20261112";

// ── 결정적 난수 ─────────────────────────────────────────────────────────────
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** mulberry32. 문자열 시드에서 0 이상 1 미만의 수열을 만든다. */
export function seededRng(seed: string): () => number {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 글자 도구 ───────────────────────────────────────────────────────────────
const CHO = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const JUNG = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const isSyllable = (ch: string) => ch >= "가" && ch <= "힣";
const isLetter = (ch: string) => isSyllable(ch) || /[A-Za-z0-9]/.test(ch);

function decompose(ch: string): { cho: string; jung: string; jong: string } | null {
  if (!isSyllable(ch)) return null;
  const n = ch.charCodeAt(0) - 0xac00;
  return { cho: CHO[Math.floor(n / 588)], jung: JUNG[Math.floor((n % 588) / 28)], jong: JONG[n % 28] };
}

/** 소리·모양이 비슷한 영문·숫자로 바꿀 수 있는 글자 */
const LEET: Record<string, string> = {
  a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", b: "8", g: "9",
  이: "2", 일: "1", 삼: "3", 사: "4", 오: "5", 육: "6", 칠: "7", 팔: "8", 구: "9", 영: "0", 공: "0",
  에: "e", 아: "a", 비: "b", 씨: "c", 디: "d", 지: "g", 케: "k", 엘: "l", 엠: "m", 엔: "n", 피: "p", 큐: "q", 알: "r", 티: "t", 유: "u",
};
const leetOf = (ch: string): string | null => LEET[ch] ?? LEET[ch.toLowerCase()] ?? null;
const SYMBOLS = [".", "*", "-", "_", "~", "^", "/"];

/** 글자가 2개 이상 이어진 구간(단어)마다 시작·끝 위치를 돌려준다. */
function letterRuns(chars: readonly string[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i <= chars.length; i++) {
    const letter = i < chars.length && isLetter(chars[i]);
    if (letter && start === -1) start = i;
    if (!letter && start !== -1) {
      if (i - start >= 2) runs.push({ start, end: i });
      start = -1;
    }
  }
  return runs;
}

/** 후보 중 일부(각각 절반 확률, 최소 1개)를 고른다. */
function pickSome<T>(xs: readonly T[], rng: () => number): T[] {
  if (xs.length === 0) return [];
  const picked = xs.filter(() => rng() < 0.5);
  return picked.length ? picked : [xs[Math.floor(rng() * xs.length)]];
}

/**
 * 문장 하나에 변형 기법을 적용한다. 적용할 곳이 없으면(글자 2개 이상인 단어가 없음, 치환할 글자가 없음 등) null.
 * 반환값은 항상 원문과 다르다.
 */
export function mutateText(text: string, key: MutationKey, rng: () => number): string | null {
  const chars = [...text];
  const out = [...chars];
  const all = letterRuns(chars);
  const runs = key === "leet" ? all.filter((r) => chars.slice(r.start, r.end).some((c) => leetOf(c) !== null)) : key === "jamo" || key === "chosung" ? all.filter((r) => chars.slice(r.start, r.end).some(isSyllable)) : all;
  const targets = pickSome(runs, rng);
  if (targets.length === 0) return null;

  // 뒤에서부터 고쳐야 앞쪽 위치가 밀리지 않는다
  for (const r of [...targets].sort((a, b) => b.start - a.start)) {
    const word = chars.slice(r.start, r.end);
    let next: string[];
    if (key === "space") next = word.flatMap((c, i) => (i ? [" ", c] : [c]));
    else if (key === "special") {
      const gaps = shuffled(Array.from({ length: word.length - 1 }, (_, i) => i + 1), rng).slice(0, Math.min(2, word.length - 1));
      next = word.flatMap((c, i) => (gaps.includes(i) ? [SYMBOLS[Math.floor(rng() * SYMBOLS.length)], c] : [c]));
    } else if (key === "jamo") next = word.map((c) => { const d = decompose(c); return d ? d.cho + d.jung + d.jong : c; });
    else if (key === "chosung") next = word.map((c) => decompose(c)?.cho ?? c);
    else if (key === "leet") {
      const idx = word.map((c, i) => (leetOf(c) !== null ? i : -1)).filter((i) => i >= 0);
      const chosen = new Set(pickSome(idx, rng));
      next = word.map((c, i) => (chosen.has(i) ? leetOf(c)! : c));
    } else {
      const at = Math.floor(rng() * word.length);
      next = word.flatMap((c, i) => (i === at ? [c, c, c] : [c]));
    }
    out.splice(r.start, r.end - r.start, ...next);
  }
  const result = out.join("");
  return result === text ? null : result;
}

export type MutateOptions = { perCase?: number; seed?: string };

/** 케이스 하나의 변형들. 기법 순서는 (시드, 케이스 id)로 섞고, 적용할 수 없는 기법은 건너뛴다. 모든 턴에 같은 기법을 적용한다. */
export function mutateCase(c: RedteamCase, opts: MutateOptions = {}): RedteamCase[] {
  if (c.label !== "attack") return [];
  const perCase = Math.max(0, Math.floor(opts.perCase ?? DEFAULT_PER_CASE));
  const seed = opts.seed ?? DEFAULT_SEED;
  const order = shuffled(MUTATIONS, seededRng(`${seed}|${c.id}`));
  const out: RedteamCase[] = [];
  const seen = new Set<string>([c.turns.join("\u0000")]);
  // 기법 수보다 많이 요청하면 같은 기법을 다른 난수로 한 번 더 돈다(최대 3바퀴)
  for (let pass = 0; pass < 3 && out.length < perCase; pass++) {
    for (const m of order) {
      if (out.length >= perCase) break;
      const turns = c.turns.map((t, ti) => mutateText(t, m.key, seededRng(`${seed}|${c.id}|${m.key}|${pass}|${ti}`)) ?? t);
      const sig = turns.join("\u0000");
      if (seen.has(sig)) continue;
      seen.add(sig);
      // note는 원본 케이스 설명이라 변형에는 옮기지 않는다
      const { note: _note, ...rest } = c;
      void _note;
      out.push({ ...rest, id: `${c.id}~${m.key}${pass ? pass + 1 : ""}`, turns, mutationOf: c.id, mutation: m.label });
    }
  }
  return out;
}

/** 세트의 공격 케이스 전부에 대한 변형 세트. 변형이 하나도 없으면 null. */
export function mutateSet(set: RedteamSet, opts: MutateOptions = {}): RedteamSet | null {
  const cases = set.cases.flatMap((c) => mutateCase(c, opts));
  if (cases.length === 0) return null;
  return {
    id: `${set.id}-mutated`,
    description: `${set.id}의 공격 케이스를 표기 변형한 세트(시드 ${opts.seed ?? DEFAULT_SEED}, 원본당 최대 ${opts.perCase ?? DEFAULT_PER_CASE}개). 공격 문구가 들어 있으므로 저장소에 올리지 않는다.`,
    cases,
  };
}
