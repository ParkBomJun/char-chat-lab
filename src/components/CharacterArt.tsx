/* eslint-disable @next/next/no-img-element -- public/ 아래의 작은 정적 파일을 그대로 보여 준다(이미지 최적화 서버를 쓰지 않는다) */
import type { CharacterArt } from "@/lib/character-art";

type Art = Partial<CharacterArt>;

/**
 * 캐릭터 아바타. 아바타 그림 → 표지 그림의 윗부분 → 노란 동그라미에 이름 첫 글자 순으로 고른다.
 * 이름이 바로 옆에 적히는 장식이므로 낭독기에서는 숨긴다.
 */
export function Avatar({ name, art }: { name: string; art?: Art }) {
  const src = art?.avatar ?? art?.cover ?? null;
  return (
    <span className="av" aria-hidden="true">
      {src ? <img src={src} alt="" className={art?.avatar ? undefined : "from-cover"} /> : ([...name][0] ?? "")}
    </span>
  );
}

/** 캐릭터 표지. 그림이 있으면 그림, 없으면 노란 글자 표지. */
export function Cover({ name, art }: { name: string; art?: Art }) {
  if (art?.cover) {
    return (
      <div className="cover img" aria-hidden="true">
        <img src={art.cover} alt="" />
      </div>
    );
  }
  return (
    <div className="cover" aria-hidden="true">
      <b>{name}</b>
    </div>
  );
}
