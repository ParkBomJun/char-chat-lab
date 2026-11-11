import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 컨테이너·로드밸런서 헬스체크. DB까지 닿는지 확인한다. 내부 정보는 노출하지 않는다. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health] DB 확인 실패", e instanceof Error ? e.message : e);
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
