import cardRulesFile from "@/config/card-rules.json";
import { compileRules, defaultRules, evaluateRules, type CompiledRule, type RuleDef } from "./rules";

/**
 * 카드 저장 단계 안전 검사(모델 호출 없음).
 * 캐릭터 카드와 로어북 본문은 고정 블록·참고 설정으로 프롬프트에 그대로 들어가고 대화 안전 검사를 거치지 않는다.
 * 그래서 저장할 때 규칙 층을 한 번 돌린다: HARD면 저장 거부, SOFT면 경고만(저장은 허용).
 *
 * 적용 규칙
 *  - safety-rules.json의 차단 규칙 전부(입력용·출력용 구분 없이). 정규화 재검사도 그대로(정규화로만 걸리면 SOFT).
 *  - 위기 규칙은 SOFT로 낮춘다: 사용자 본인의 발화를 위한 규칙이라, 예시 대화의 사용자 대사("…죽고 싶어")를 저장 거부하면 안 된다.
 *  - card-rules.json: 카드에만 해당하는 규칙(지시 무시 지시문, 영문 성적 표현).
 */
export type CardField = "persona" | "speechStyle" | "exampleDialog" | "greeting" | "lorebook";
export const CARD_FIELDS: readonly CardField[] = ["persona", "speechStyle", "exampleDialog", "greeting", "lorebook"];
export const CARD_FIELD_LABEL: Record<CardField, string> = {
  persona: "성격·배경",
  speechStyle: "말투",
  exampleDialog: "예시 대화",
  greeting: "첫 인사",
  lorebook: "로어북 내용",
};
const CATEGORY_LABEL: Record<string, string> = {
  jailbreak: "지시 무시·탈옥 지시문",
  sexual: "성적 표현",
  violence: "폭력 표현",
  crisis: "위기 표현",
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

export type CardFinding = { field: CardField; category: string };
export type CardCheck = { blocked: CardFinding[]; warnings: CardFinding[] };

export const cardRules: CompiledRule[] = [
  ...defaultRules.map((r): CompiledRule => ({ ...r, appliesTo: ["card"], tier: r.kind === "crisis" ? "soft" : r.tier })),
  ...compileRules(cardRulesFile.rules as RuleDef[]),
];

/** 필드별로 규칙 층을 돌린다. 없는 필드는 건너뛴다. */
export function checkCardFields(fields: Partial<Record<CardField, string>>, rules: readonly CompiledRule[] = cardRules): CardCheck {
  const out: CardCheck = { blocked: [], warnings: [] };
  for (const field of CARD_FIELDS) {
    const text = fields[field];
    if (!text) continue;
    const ev = evaluateRules(text, "card", rules);
    if (ev.hard) out.blocked.push({ field, category: ev.hard.category });
    for (const s of ev.soft) {
      if (!out.warnings.some((w) => w.field === field && w.category === s.category)) out.warnings.push({ field, category: s.category });
    }
  }
  return out;
}

export const blockedMessage = (b: readonly CardFinding[]) =>
  `저장하지 않았습니다. 안전 규칙에 걸린 내용이 있습니다: ${b.map((f) => `${CARD_FIELD_LABEL[f.field]}(${categoryLabel(f.category)})`).join(", ")}. 해당 표현을 고친 뒤 다시 저장해 주세요.`;
export const warningMessage = (w: readonly CardFinding[]) =>
  `저장은 했지만 확인이 필요한 표현이 있습니다: ${w.map((f) => `${CARD_FIELD_LABEL[f.field]}(${categoryLabel(f.category)})`).join(", ")}. 전연령 서비스에 맞는 내용인지 다시 봐 주세요.`;

/** 경고를 주소 쿼리로 넘기기 위한 부호화. 화면은 허용된 필드·범주 이름만 되읽는다(임의 문구를 주소로 주입할 수 없게). */
export const encodeFindings = (w: readonly CardFinding[]) => w.map((f) => `${f.field}:${f.category}`).join(",");
export function decodeFindings(raw: string | undefined): CardFinding[] {
  if (!raw) return [];
  return raw.split(",").flatMap((part) => {
    const [field, category] = part.split(":");
    return (CARD_FIELDS as readonly string[]).includes(field) && category in CATEGORY_LABEL ? [{ field: field as CardField, category }] : [];
  });
}

type CardLike = { persona: string; speechStyle: string; exampleDialog: string; greeting: string };

/** 카드 한 장(캐릭터 + 로어북 본문들)을 검사한다. seed와 테스트가 쓴다. */
export function checkCard(character: CardLike, lorebook: readonly { content: string }[] = []): CardCheck {
  const out = checkCardFields(character);
  for (const l of lorebook) {
    const r = checkCardFields({ lorebook: l.content });
    out.blocked.push(...r.blocked);
    for (const w of r.warnings) if (!out.warnings.some((x) => x.field === w.field && x.category === w.category)) out.warnings.push(w);
  }
  return out;
}

/** HARD 적중이 있으면 예외(seed 중단용). 경고 목록을 돌려준다. */
export function assertCardSafe(character: CardLike, lorebook: readonly { content: string }[] = [], name = "카드"): CardFinding[] {
  const r = checkCard(character, lorebook);
  if (r.blocked.length) {
    throw new Error(`${name}: 카드 안전 검사를 통과하지 못했습니다 — ${r.blocked.map((f) => `${CARD_FIELD_LABEL[f.field]}(${categoryLabel(f.category)})`).join(", ")}`);
  }
  return r.warnings;
}
