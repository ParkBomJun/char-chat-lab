import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * 관리자 확인. 페이지와 서버 액션 모두에서 직접 호출한다(레이아웃 검사만으로는 서버 액션이 보호되지 않는다).
 * 로그인 시점의 토큰이 아니라 DB의 현재 역할을 본다 → 강등이 즉시 반영된다.
 * 관리자가 아니면 404로 존재 자체를 숨긴다.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, email: true } });
  if (!user || user.role !== "ADMIN") notFound();
  return { id: session.user.id, email: user.email };
}
