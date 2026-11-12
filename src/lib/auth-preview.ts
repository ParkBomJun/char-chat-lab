import { prisma } from "@/lib/db";

/** 로그인·회원가입 화면 왼쪽에 보여 줄 첫 공개 캐릭터의 이름과 첫 인사(로그인 뒤 누구에게나 보이는 공개 정보) */
export async function getAuthPreview(): Promise<{ name: string; greeting: string } | null> {
  return prisma.character.findFirst({
    where: { isPublished: true },
    orderBy: { createdAt: "asc" },
    select: { name: true, greeting: true },
  });
}
