import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { startConversationAction } from "@/app/actions/conversation";
import { Avatar, Cover } from "@/components/CharacterArt";
import { resolveArt } from "@/lib/character-art";
import { loadConfig } from "@/lib/config";
import { countTodayMessages } from "@/lib/daily-limit";
import { HOME_LIST_TAKE, homeConversationWhere } from "@/lib/home-list";
import { kstListTime, remainingMessages } from "@/lib/kst";

export const dynamic = "force-dynamic";

/** 목록 미리보기: 첫 줄만, 너무 길면 자른다(화면에서는 한 줄 말줄임) */
const previewOf = (content: string | undefined) => (content ?? "").split("\n")[0].slice(0, 120);

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [characters, conversations, used] = await Promise.all([
    prisma.character.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, tagline: true, greeting: true, imageUrl: true, avatarUrl: true },
    }),
    prisma.conversation.findMany({
      where: homeConversationWhere(session.user.id),
      orderBy: { createdAt: "desc" },
      take: HOME_LIST_TAKE,
      select: {
        id: true,
        createdAt: true,
        character: { select: { name: true, imageUrl: true, avatarUrl: true } },
        // 미리보기용: 회수되지 않은 사용자·캐릭터 메시지 중 마지막 1건만(안내문 제외)
        messages: {
          where: { retracted: false, role: { in: ["USER", "ASSISTANT"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
    }),
    countTodayMessages(session.user.id),
  ]);
  const remaining = remainingMessages(loadConfig().dailyMessageLimit, used);
  const now = new Date();
  const list = conversations
    .map((v) => ({ id: v.id, name: v.character.name, art: resolveArt(v.character), preview: previewOf(v.messages[0]?.content), at: v.messages[0]?.createdAt ?? v.createdAt }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="page">
      <header className="top">
        <div className="wrap">
          <Link href="/" className="brand">정원 도서관</Link>
          <form action={logoutAction} className="nav" aria-label="계정">
            {session.user.role === "ADMIN" && <Link href="/admin">관리자</Link>}
            <span className="email">{session.user.email}</span>
            <button type="submit">로그아웃</button>
          </form>
        </div>
      </header>
      <main className="wrap home">
        <section className="col-main">
          <h1 className="h1">캐릭터</h1>
          {characters.length === 0 ? (
            <p className="empty">공개된 캐릭터가 없습니다.</p>
          ) : (
            characters.map((c) => (
              <article key={c.id} className="char">
                <Cover name={c.name} art={resolveArt(c)} />
                <div className="char-head">
                  <div className="char-name"><h2>{c.name}</h2></div>
                  <p>{c.tagline}</p>
                </div>
                <div className="char-greet">
                  <span>첫 인사</span>
                  <p>{c.greeting}</p>
                </div>
                <form action={startConversationAction} className="char-act">
                  <input type="hidden" name="characterId" value={c.id} />
                  <button type="submit" className="btn">대화 시작</button>
                  <span className="small">오늘 남은 메시지 {remaining}개</span>
                </form>
              </article>
            ))
          )}
          <p className="small">전 연령 서비스입니다. 모든 대화는 AI가 생성합니다.</p>
        </section>
        <section className="col-side">
          <div className="side-head">
            <h2 className="h2">내 대화</h2>
            <span className="small">최근 순</span>
          </div>
          {list.length === 0 ? (
            <p className="empty">
              아직 대화가 없어요.{characters[0] ? ` ${characters[0].name}에게 먼저 말을 걸어 보세요.` : ""}
            </p>
          ) : (
            <ul className="convs">
              {list.map((v) => (
                <li key={v.id}>
                  <Link href={`/chat/${v.id}`}>
                    <Avatar name={v.name} art={v.art} />
                    <span className="conv-txt"><b>{v.name}</b><span>{v.preview}</span></span>
                    <span className="time">{kstListTime(v.at, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="foot">
        <div className="wrap">
          <span>포트폴리오 프로젝트 · char-chat-lab</span>
          <Link href="/privacy">데모 서비스 안내</Link>
        </div>
      </footer>
    </div>
  );
}
