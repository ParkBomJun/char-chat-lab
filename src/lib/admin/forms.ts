import { z } from "zod";
import { validateKeywords } from "@/lib/lorebook/keywords";

const req = (label: string, max: number) =>
  z.string().trim().min(1, `${label}을(를) 입력해 주세요.`).max(max, `${label}은(는) ${max}자 이하여야 합니다.`);

/** 그림 경로 규칙: 사이트 내부의 /characters/ 아래 파일만. 외부 주소·상위 경로·쿼리는 받지 않는다. */
export const CHARACTER_IMAGE_PATH = /^\/characters\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:webp|png|jpg|jpeg)$/;
const imagePath = (label: string) =>
  z
    .string()
    .trim()
    .max(200, `${label}는 200자 이하여야 합니다.`)
    .refine((v) => v === "" || CHARACTER_IMAGE_PATH.test(v), `${label}는 /characters/로 시작하는 사이트 내부 그림 경로(webp·png·jpg)만 쓸 수 있습니다.`)
    .transform((v) => (v === "" ? null : v));

export const characterSchema = z.object({
  name: req("이름", 40),
  tagline: req("한 줄 소개", 100),
  persona: req("성격·배경", 4000),
  speechStyle: req("말투", 2000),
  exampleDialog: req("예시 대화", 4000),
  greeting: req("첫 인사", 1000),
  imageUrl: imagePath("표지 그림 경로"),
  avatarUrl: imagePath("아바타 그림 경로"),
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
    imageUrl: str(fd, "imageUrl"),
    avatarUrl: str(fd, "avatarUrl"),
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
