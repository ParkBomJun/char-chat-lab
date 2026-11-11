import rulesFile from "@/config/safety-rules.json";

export type RuleTarget = "input" | "output";
export type RuleKind = "block" | "crisis";

export type RuleDef = {
  category: string;
  kind: RuleKind;
  appliesTo: RuleTarget[];
  spaced?: boolean;
  words?: string[];
  regex?: string[];
};
export type CompiledRule = { category: string; kind: RuleKind; appliesTo: RuleTarget[]; patterns: RegExp[] };

export type RuleResult = { kind: "none" } | { kind: RuleKind; category: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 규칙 검사용 정규화: NFC, 소문자, 제로폭 문자 제거, 공백은 하나로. */
export function normalizeForRules(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ");
}

export function compileRules(defs: readonly RuleDef[]): CompiledRule[] {
  return defs.map((d) => {
    const patterns: RegExp[] = [];
    for (const w of d.words ?? []) {
      const chars = [...w.toLowerCase()];
      // 공백 허용은 3글자 이상 단어에만: "죽고 싶다"는 잡아야 하지만, 2글자 단어에 허용하면
      // "사자 살았다"의 "자 살"처럼 서로 다른 단어 사이가 걸린다. 띄어 쓴 2글자 우회는 분류기 층이 맡는다.
      const src = d.spaced && chars.length >= 3 ? chars.map(escapeRe).join("\\s*") : escapeRe(w.toLowerCase());
      patterns.push(new RegExp(src, "u"));
    }
    for (const r of d.regex ?? []) patterns.push(new RegExp(r, "iu"));
    return { category: d.category, kind: d.kind, appliesTo: d.appliesTo, patterns };
  });
}

export const defaultRules: CompiledRule[] = compileRules(rulesFile.rules as RuleDef[]);

/**
 * 규칙 층 검사. 위기 표현은 차단보다 우선한다(사용자 보호가 먼저).
 * 출력에는 위기 규칙을 쓰지 않는다: 캐릭터가 위로하며 "자살"을 언급하는 정상 응답을 회수하지 않기 위해.
 */
export function checkRules(text: string, target: RuleTarget, rules: readonly CompiledRule[] = defaultRules): RuleResult {
  const t = normalizeForRules(text);
  const applicable = rules.filter((r) => r.appliesTo.includes(target));
  for (const kind of ["crisis", "block"] as const) {
    for (const r of applicable) {
      if (r.kind === kind && r.patterns.some((p) => p.test(t))) return { kind, category: r.category };
    }
  }
  return { kind: "none" };
}
