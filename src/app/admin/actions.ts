"use server";

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { parseCharacterForm, parseLoreForm } from "@/lib/admin/forms";
import { saveCharacterChecked, saveLoreChecked } from "@/lib/admin/card-save";
import { encodeFindings } from "@/lib/safety/card-check";

export type CharacterFormState = { error?: string; values?: Record<string, string | boolean> } | undefined;

const FIELDS = ["name", "tagline", "persona", "speechStyle", "exampleDialog", "greeting"] as const;

/** 서버 액션은 URL로 직접 호출될 수 있으므로 모든 액션이 스스로 관리자 확인을 한다. */
export async function saveCharacterAction(_prev: CharacterFormState, fd: FormData): Promise<CharacterFormState> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");

  // 긴 텍스트를 다시 쓰지 않도록 입력값을 되돌려 준다
  const echo = (error: string): CharacterFormState => {
    const values: Record<string, string | boolean> = { isPublished: fd.get("isPublished") === "on" };
    for (const f of FIELDS) values[f] = String(fd.get(f) ?? "");
    return { error, values };
  };

  const parsed = parseCharacterForm(fd);
  if (!parsed.ok) return echo(parsed.error);

  // 카드 안전 검사(규칙 층, 모델 호출 없음): HARD면 저장하지 않고 사유를 보여 준다. SOFT는 저장 후 경고.
  const r = await saveCharacterChecked(prisma, id || null, parsed.data);
  if (!r.ok) {
    if (r.reason === "not_found") notFound();
    return echo(r.error);
  }
  redirect(`/admin/characters/${r.id}?saved=1${r.warnings.length ? `&warn=${encodeURIComponent(encodeFindings(r.warnings))}` : ""}`);
}

const back = (characterId: string, q: string) => `/admin/characters/${characterId}?${q}#lorebook`;

export async function saveLoreAction(fd: FormData) {
  await requireAdmin();
  const characterId = String(fd.get("characterId") ?? "");
  const entryId = String(fd.get("entryId") ?? "");

  const character = await prisma.character.findUnique({ where: { id: characterId }, select: { id: true } });
  if (!character) notFound();

  const parsed = parseLoreForm(fd);
  if (!parsed.ok) redirect(back(characterId, `error=${encodeURIComponent(parsed.error)}`));

  // 로어북 본문도 프롬프트에 그대로 들어가므로 같은 검사를 거친다
  const r = await saveLoreChecked(prisma, characterId, entryId || null, parsed.data);
  if (!r.ok) {
    if (r.reason === "not_found") notFound();
    redirect(back(characterId, `error=${encodeURIComponent(r.error)}`));
  }
  redirect(back(characterId, `saved=lore${r.warnings.length ? `&warn=${encodeURIComponent(encodeFindings(r.warnings))}` : ""}`));
}

export async function deleteLoreAction(fd: FormData) {
  await requireAdmin();
  const characterId = String(fd.get("characterId") ?? "");
  const entryId = String(fd.get("entryId") ?? "");
  const entry = await prisma.lorebookEntry.findFirst({ where: { id: entryId, characterId }, select: { id: true } });
  if (!entry) notFound();
  await prisma.lorebookEntry.delete({ where: { id: entryId } });
  redirect(back(characterId, "saved=lore"));
}
