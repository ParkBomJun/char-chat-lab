import { z } from "zod";
import { validateKeywords } from "@/lib/lorebook/keywords";

export const characterFileSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().default(""),
  persona: z.string().min(1),
  speechStyle: z.string().min(1),
  exampleDialog: z.string().min(1),
  greeting: z.string().min(1),
});
export type CharacterFile = z.infer<typeof characterFileSchema>;

export const lorebookEntrySchema = z
  .object({
    id: z.string().min(1),
    keywords: z.array(z.string()).min(1),
    content: z.string().min(1),
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
  })
  .superRefine((e, ctx) => {
    // 서비스 등록 규칙과 같은 검증(공백 제외 2글자 이상 등)
    const v = validateKeywords(e.keywords);
    for (const msg of v.errors) ctx.addIssue({ code: "custom", message: `로어북 ${e.id}: ${msg}` });
  });

export const configOverrideSchema = z
  .object({
    recentTurns: z.number().int().min(1),
    summaryEvery: z.number().int().min(1),
    promptTokenBudget: z.number().int().min(500),
    lorebookTokenBudget: z.number().int().min(0),
    lorebookScanTurns: z.number().int().min(1),
  })
  .partial();
export type ConfigOverride = z.infer<typeof configOverrideSchema>;

export const scenarioSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(""),
  /** eval/characters/ 아래 파일 이름(확장자 제외) */
  character: z.string().min(1),
  lorebook: z.array(lorebookEntrySchema).default([]),
  /** 사용자 발화만. 캐릭터 응답은 모델이 생성한다. */
  turns: z.array(z.string().min(1)).min(1),
  config: configOverrideSchema.optional(),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const redteamCaseSchema = z
  .object({
    id: z.string().min(1),
    label: z.enum(["attack", "benign"]),
    category: z.string().default("unspecified"),
    /** 한 대화를 이루는 사용자 발화 목록. 점진적으로 수위가 올라가는 다중 턴 공격도 한 케이스로 쓴다. */
    turns: z.array(z.string().min(1)).min(1),
    /** 기본값: attack→block, benign→pass. 위기 표현 케이스는 crisis로 지정 */
    expect: z.enum(["block", "crisis", "pass"]).optional(),
    note: z.string().optional(),
  })
  .transform((c) => ({ ...c, expect: c.expect ?? (c.label === "attack" ? ("block" as const) : ("pass" as const)) }))
  .superRefine((c, ctx) => {
    if (c.label === "benign" && c.expect !== "pass") ctx.addIssue({ code: "custom", message: `${c.id}: benign 케이스는 expect=pass만 가능` });
    if (c.label === "attack" && c.expect === "pass") ctx.addIssue({ code: "custom", message: `${c.id}: attack 케이스는 expect=block|crisis` });
  });
export type RedteamCase = z.output<typeof redteamCaseSchema>;

export const redteamSetSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(""),
  cases: z.array(redteamCaseSchema).min(1),
});
export type RedteamSet = z.output<typeof redteamSetSchema>;
