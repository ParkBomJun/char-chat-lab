import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logoutAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const characters = await prisma.character.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, tagline: true },
  });

  return (
    <>
      <header className="site-header">
        <strong>char-chat-lab</strong>
        <form action={logoutAction}>
          <span className="who">{session.user.email}</span>
          <button type="submit" className="link">로그아웃</button>
        </form>
      </header>
      <main className="page">
        <h1>캐릭터</h1>
        <p>AI 캐릭터와 대화해 보세요. 모든 대화는 AI가 생성합니다.</p>
        {characters.length === 0 ? (
          <p>공개된 캐릭터가 없습니다.</p>
        ) : (
          <div className="card-grid">
            {characters.map((c) => (
              <article key={c.id} className="char-card">
                <h2>{c.name}</h2>
                <p>{c.tagline}</p>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
