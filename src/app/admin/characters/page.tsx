import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function CharacterList() {
  const characters = await prisma.character.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, tagline: true, isPublished: true, _count: { select: { lorebook: true, conversations: true } } },
  });
  return (
    <section className="sec">
      <div className="sec-head">
        <h1 className="h1">캐릭터</h1>
        <Link href="/admin/characters/new" className="btn line">새 캐릭터</Link>
      </div>
      <div className="tbl-wrap">
      <table className="admin-table" style={{ minWidth: 560 }}>
        <thead><tr><th scope="col">이름</th><th scope="col">소개</th><th scope="col">공개</th><th scope="col" className="num">로어북</th><th scope="col" className="num">대화 수</th></tr></thead>
        <tbody>
          {characters.length === 0 && <tr><td colSpan={5}>캐릭터가 없습니다.</td></tr>}
          {characters.map((c) => (
            <tr key={c.id}>
              <td className="nowrap"><Link href={`/admin/characters/${c.id}`}><b>{c.name}</b></Link></td>
              <td>{c.tagline}</td><td className={c.isPublished ? "nowrap" : "nowrap dim"}>{c.isPublished ? "공개" : "비공개"}</td><td className="num">{c._count.lorebook}</td><td className="num">{c._count.conversations}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
