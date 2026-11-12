import { existsSync } from "node:fs";
import path from "node:path";
import { CHARACTER_IMAGE_PATH } from "@/lib/admin/forms";

export type CharacterArt = { cover: string | null; avatar: string | null };

/**
 * 화면에 쓸 그림 경로를 정한다(서버 전용).
 * 규칙에 맞는 내부 경로이고 public/ 아래에 파일이 실제로 있을 때만 돌려준다.
 * 파일이 아직 없으면 null → 화면은 글자 표지·글자 아바타로 보인다(깨진 그림을 보이지 않는다).
 */
function usable(url: string | null | undefined): string | null {
  if (!url || !CHARACTER_IMAGE_PATH.test(url)) return null;
  return existsSync(path.join(process.cwd(), "public", url)) ? url : null;
}

export function resolveArt(c: { imageUrl: string | null; avatarUrl: string | null }): CharacterArt {
  return { cover: usable(c.imageUrl), avatar: usable(c.avatarUrl) };
}
