import Link from "next/link";
import { CharacterForm } from "@/components/admin/CharacterForm";

export default function NewCharacter() {
  return (
    <section className="sec">
      <p className="small"><Link href="/admin/characters">← 목록</Link></p>
      <h1 className="h1">새 캐릭터</h1>
      <p className="note-s">오리지널 캐릭터만, 전연령 내용으로 작성합니다. 저장한 뒤 로어북을 추가할 수 있습니다.</p>
      <CharacterForm initial={{ name: "", tagline: "", persona: "", speechStyle: "", exampleDialog: "", greeting: "", imageUrl: "", avatarUrl: "", isPublished: false }} />
    </section>
  );
}
