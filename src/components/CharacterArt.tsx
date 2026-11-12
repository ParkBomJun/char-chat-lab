/** 캐릭터 아바타. 그림이 없으면 노란 동그라미에 이름 첫 글자. 장식이므로 낭독기에서는 숨긴다. */
export function Avatar({ name }: { name: string }) {
  return <span className="av" aria-hidden="true">{[...name][0] ?? ""}</span>;
}

/** 캐릭터 표지. 그림이 없으면 노란 글자 표지. */
export function Cover({ name }: { name: string }) {
  return (
    <div className="cover" aria-hidden="true">
      <b>{name}</b>
    </div>
  );
}
