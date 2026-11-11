import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { startConversationAction } from "@/app/actions/conversation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const characters = await prisma.character.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, tagline: true },
  });

  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, character: { select: { name: true } } },
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
                <form action={startConversationAction}>
                  <input type="hidden" name="characterId" value={c.id} />
                  <button type="submit">대화 시작</button>
                </form>
              </article>
            ))}
          </div>
        )}
        {conversations.length > 0 && (
          <>
            <h2>내 대화</h2>
            <ul className="conv-list">
              {conversations.map((v) => (
                <li key={v.id}>
                  <Link href={`/chat/${v.id}`}>{v.character.name}</Link>{" "}
                  <span className="who">{v.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
