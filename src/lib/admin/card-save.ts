import type { PrismaClient } from "@/generated/prisma/client";
import { blockedMessage, checkCardFields, type CardFinding } from "@/lib/safety/card-check";
import type { CharacterInput, LoreInput } from "./forms";

/**
 * 캐릭터·로어북 저장(안전 검사 포함). 서버 액션과 테스트(테스트 DB)가 같은 함수를 쓴다.
 * HARD 적중이면 DB에 아무것도 쓰지 않고 사유를 돌려준다. SOFT는 저장하고 경고를 돌려준다.
 */
type Db = Pick<PrismaClient, "character" | "lorebookEntry">;
export type SaveResult =
  | { ok: true; id: string; warnings: CardFinding[] }
  | { ok: false; reason: "blocked"; error: string; blocked: CardFinding[] }
  | { ok: false; reason: "not_found" };

export async function saveCharacterChecked(db: Db, id: string | null, data: CharacterInput): Promise<SaveResult> {
  const check = checkCardFields({ persona: data.persona, speechStyle: data.speechStyle, exampleDialog: data.exampleDialog, greeting: data.greeting });
  if (check.blocked.length) return { ok: false, reason: "blocked", error: blockedMessage(check.blocked), blocked: check.blocked };
  if (id) {
    const exists = await db.character.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return { ok: false, reason: "not_found" };
    await db.character.update({ where: { id }, data });
    return { ok: true, id, warnings: check.warnings };
  }
  const created = await db.character.create({ data, select: { id: true } });
  return { ok: true, id: created.id, warnings: check.warnings };
}

export async function saveLoreChecked(db: Db, characterId: string, entryId: string | null, data: LoreInput): Promise<SaveResult> {
  const character = await db.character.findUnique({ where: { id: characterId }, select: { id: true } });
  if (!character) return { ok: false, reason: "not_found" };
  const check = checkCardFields({ lorebook: data.content });
  if (check.blocked.length) return { ok: false, reason: "blocked", error: blockedMessage(check.blocked), blocked: check.blocked };
  if (entryId) {
    // 다른 캐릭터의 항목을 id만 바꿔 수정하지 못하게 소속을 함께 확인한다
    const entry = await db.lorebookEntry.findFirst({ where: { id: entryId, characterId }, select: { id: true } });
    if (!entry) return { ok: false, reason: "not_found" };
    await db.lorebookEntry.update({ where: { id: entryId }, data });
    return { ok: true, id: entryId, warnings: check.warnings };
  }
  const created = await db.lorebookEntry.create({ data: { characterId, ...data }, select: { id: true } });
  return { ok: true, id: created.id, warnings: check.warnings };
}
