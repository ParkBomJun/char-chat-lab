import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 컨테이너·로드밸런서 헬스체크. DB까지 닿는지 확인한다. 내부 정보는 노출하지 않는다. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // APP_ENV가 설정된 경우(테스트 서버)에만 알려 준다. E2E 스크립트가 시작할 때 env==="test"인지 확인해 개발 서버에 잘못 붙는 일을 막는다.
    return Response.json({ status: "ok", ...(process.env.APP_ENV ? { env: process.env.APP_ENV } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health] DB 확인 실패", e instanceof Error ? e.message : e);
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
