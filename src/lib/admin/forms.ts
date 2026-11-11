import { z } from "zod";
import { validateKeywords } from "@/lib/lorebook/keywords";

const req = (label: string, max: number) =>
  z.string().trim().min(1, `${label}을(를) 입력해 주세요.`).max(max, `${label}은(는) ${max}자 이하여야 합니다.`);

export const characterSchema = z.object({
  name: req("이름", 40),
  tagline: req("한 줄 소개", 100),
  persona: req("성격·배경", 4000),
  speechStyle: req("말투", 2000),
  exampleDialog: req("예시 대화", 4000),
  greeting: req("첫 인사", 1000),
  isPublished: z.boolean(),
});
export type CharacterInput = z.infer<typeof characterSchema>;

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export function parseCharacterForm(fd: FormData): Parsed<CharacterInput> {
  const r = characterSchema.safeParse({
    name: str(fd, "name"),
    tagline: str(fd, "tagline"),
    persona: str(fd, "persona"),
    speechStyle: str(fd, "speechStyle"),
    exampleDialog: str(fd, "exampleDialog"),
    greeting: str(fd, "greeting"),
    isPublished: fd.get("isPublished") === "on",
  });
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error.issues[0].message };
}

export type LoreInput = { keywords: string[]; content: string; priority: number; enabled: boolean };

/** 키워드는 줄바꿈·쉼표로 구분. 등록 규칙(공백 제외 2글자 이상 등)은 5단계 매칭과 같은 검증을 쓴다. */
export function parseLoreForm(fd: FormData): Parsed<LoreInput> {
  const kw = validateKeywords(str(fd, "keywords").split(/[\n,]/));
  if (kw.errors.length) return { ok: false, error: kw.errors[0] };

  const content = str(fd, "content").trim();
  if (!content) return { ok: false, error: "내용을 입력해 주세요." };
  if (content.length > 1000) return { ok: false, error: "내용은 1000자 이하여야 합니다." };

  const rawPriority = str(fd, "priority").trim();
  const priority = rawPriority === "" ? 0 : Number(rawPriority);
  if (!Number.isInteger(priority) || priority < -100 || priority > 100) {
    return { ok: false, error: "우선순위는 -100~100 사이의 정수여야 합니다." };
  }
  return { ok: true, data: { keywords: kw.keywords, content, priority, enabled: fd.get("enabled") === "on" } };
}
