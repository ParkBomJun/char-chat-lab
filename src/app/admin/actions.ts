"use server";

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { parseCharacterForm, parseLoreForm } from "@/lib/admin/forms";

export type CharacterFormState = { error?: string; values?: Record<string, string | boolean> } | undefined;

const FIELDS = ["name", "tagline", "persona", "speechStyle", "exampleDialog", "greeting"] as const;

/** 서버 액션은 URL로 직접 호출될 수 있으므로 모든 액션이 스스로 관리자 확인을 한다. */
export async function saveCharacterAction(_prev: CharacterFormState, fd: FormData): Promise<CharacterFormState> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");

  const parsed = parseCharacterForm(fd);
  if (!parsed.ok) {
    // 긴 텍스트를 다시 쓰지 않도록 입력값을 되돌려 준다
    const values: Record<string, string | boolean> = { isPublished: fd.get("isPublished") === "on" };
    for (const f of FIELDS) values[f] = String(fd.get(f) ?? "");
    return { error: parsed.error, values };
  }

  if (id) {
    const exists = await prisma.character.findUnique({ where: { id }, select: { id: true } });
    if (!exists) notFound();
    await prisma.character.update({ where: { id }, data: parsed.data });
    redirect(`/admin/characters/${id}?saved=1`);
  }
  const created = await prisma.character.create({ data: parsed.data, select: { id: true } });
  redirect(`/admin/characters/${created.id}?saved=1`);
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

  if (entryId) {
    // 다른 캐릭터의 항목을 id만 바꿔 수정하지 못하게 소속을 함께 확인한다
    const entry = await prisma.lorebookEntry.findFirst({ where: { id: entryId, characterId }, select: { id: true } });
    if (!entry) notFound();
    await prisma.lorebookEntry.update({ where: { id: entryId }, data: parsed.data });
  } else {
    await prisma.lorebookEntry.create({ data: { characterId, ...parsed.data } });
  }
  redirect(back(characterId, "saved=lore"));
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
