"use client";

import { useActionState } from "react";
import { saveCharacterAction, type CharacterFormState } from "@/app/admin/actions";

export type CharacterValues = {
  id?: string;
  name: string;
  tagline: string;
  persona: string;
  speechStyle: string;
  exampleDialog: string;
  greeting: string;
  imageUrl: string;
  avatarUrl: string;
  isPublished: boolean;
};

const fields: { name: keyof CharacterValues; label: string; rows?: number; max: number }[] = [
  { name: "name", label: "이름", max: 40 },
  { name: "tagline", label: "한 줄 소개", max: 100 },
  { name: "persona", label: "성격·배경", rows: 18, max: 4000 },
  { name: "speechStyle", label: "말투", rows: 8, max: 2000 },
  { name: "exampleDialog", label: "예시 대화", rows: 18, max: 4000 },
  { name: "greeting", label: "첫 인사", rows: 3, max: 1000 },
];

export function CharacterForm({ initial }: { initial: CharacterValues }) {
  const [state, action, pending] = useActionState<CharacterFormState, FormData>(saveCharacterAction, undefined);
  const v = (k: keyof CharacterValues) => String((state?.values?.[k] as string | undefined) ?? initial[k] ?? "");

  return (
    <form action={action} className="admin-form">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {fields.map((f) => (
        <label key={f.name}>
          <span>{f.label} <span className="who">(최대 {f.max}자)</span></span>
          {f.rows ? (
            <textarea name={f.name} rows={f.rows} defaultValue={v(f.name)} maxLength={f.max} required />
          ) : (
            <input name={f.name} defaultValue={v(f.name)} maxLength={f.max} required />
          )}
        </label>
      ))}
      {(["imageUrl", "avatarUrl"] as const).map((k) => (
        <label key={k}>
          <span>{k === "imageUrl" ? "표지 그림 경로" : "아바타 그림 경로"} <span className="who">(선택. /characters/로 시작하는 사이트 내부 경로만. 비우면 글자 {k === "imageUrl" ? "표지" : "아바타"})</span></span>
          <input name={k} defaultValue={v(k)} maxLength={200} placeholder={k === "imageUrl" ? "/characters/haru/cover.webp" : "/characters/haru/avatar.webp"} />
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          name="isPublished"
          defaultChecked={state?.values ? Boolean(state.values.isPublished) : initial.isPublished}
        />
        공개 (캐릭터 목록에 표시)
      </label>
      {state?.error && <p className="error">{state.error}</p>}
      <button type="submit" className="btn start" disabled={pending}>{pending ? "저장 중…" : "저장"}</button>
    </form>
  );
}
