import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function CharacterList() {
  const characters = await prisma.character.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, tagline: true, isPublished: true, _count: { select: { lorebook: true, conversations: true } } },
  });
  return (
    <>
      <h1>캐릭터</h1>
      <p><Link href="/admin/characters/new">+ 새 캐릭터</Link></p>
      <table className="admin-table">
        <thead><tr><th>이름</th><th>소개</th><th>공개</th><th>로어북</th><th>대화 수</th></tr></thead>
        <tbody>
          {characters.length === 0 && <tr><td colSpan={5}>캐릭터가 없습니다.</td></tr>}
          {characters.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/admin/characters/${c.id}`}>{c.name}</Link></td>
              <td>{c.tagline}</td><td>{c.isPublished ? "공개" : "비공개"}</td><td>{c._count.lorebook}</td><td>{c._count.conversations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
