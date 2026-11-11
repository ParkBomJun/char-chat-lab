"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function startConversationAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const characterId = String(formData.get("characterId") ?? "");
  const character = await prisma.character.findFirst({
    where: { id: characterId, isPublished: true },
    select: { id: true, greeting: true },
  });
  if (!character) redirect("/");

  // 대화와 첫 인사를 함께 만든다.
  const conv = await prisma.conversation.create({
    data: {
      userId: session.user.id,
      characterId: character.id,
      messages: { create: { role: "ASSISTANT", content: character.greeting } },
    },
    select: { id: true },
  });
  redirect(`/chat/${conv.id}`);
}
