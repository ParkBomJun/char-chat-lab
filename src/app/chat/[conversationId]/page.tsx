import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
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

  return (
    <>
      <header className="site-header">
        <Link href="/">← 캐릭터 목록</Link>
        <strong>{conv.character.name}</strong>
        <span className="who">AI와의 대화입니다</span>
      </header>
      <ChatView conversationId={conversationId} characterName={conv.character.name} initialMessages={conv.messages} initialStopped={conv.status === "STOPPED"} initialRemaining={remaining} />
    </>
  );
}
