import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Avatar } from "@/components/CharacterArt";
import { ChatView } from "@/components/ChatView";
import { loadConfig } from "@/lib/config";
import { countTodayMessages } from "@/lib/daily-limit";
import { remainingMessages } from "@/lib/kst";

export const dynamic = "force-dynamic";

export default async function ChatPage(props: PageProps<"/chat/[conversationId]">) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { conversationId } = await props.params;
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    select: {
      status: true,
      characterId: true,
      character: { select: { name: true } },
      messages: {
        where: { retracted: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true },
      },
    },
  });
  if (!conv) notFound();

  const remaining = remainingMessages(loadConfig().dailyMessageLimit, await countTodayMessages(session.user.id));

  const name = conv.character.name;
  return (
    <div className="chat">
      <header className="top chat-top">
        <div className="wrap">
          <Link className="back" href="/" aria-label="목록으로">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            <span>목록</span>
          </Link>
          <div className="chat-who">
            <Avatar name={name} />
            <div className="chat-who-txt">
              <b>{name}</b>
              <span className="ai-note m">AI와의 대화입니다</span>
            </div>
          </div>
          <span className="ai-note">AI와의 대화입니다</span>
        </div>
      </header>
      <ChatView conversationId={conversationId} characterId={conv.characterId} characterName={name} initialMessages={conv.messages} initialStopped={conv.status === "STOPPED"} initialRemaining={remaining} />
    </div>
  );
}
