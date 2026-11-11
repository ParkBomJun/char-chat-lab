/**
 * 기존 메시지의 응답 품질 지표를 다시 계산한다(모델 호출 없음).
 *   npm run metrics:backfill              테스트 DB(APP_ENV=test)면 바로 실행, 그 밖의 DB(개발 등)는 대상만 보여 주고 멈춤
 *   npm run metrics:backfill -- --yes     개발 DB에 실제로 기록
 * 대상: 회수되지 않은 ASSISTANT 응답(대화의 첫 인사 제외). ResponseMetric에 메시지당 1행으로 덮어쓴다.
 * 메시지·대화는 읽기만 하고 고치지 않는다. 회수된 메시지에 남아 있는 지표 행이 있으면 지운다.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { pickMetricTargets } from "../src/lib/quality/backfill";
import { saveResponseMetric } from "../src/lib/quality/persist";
import { databaseNameOf, isTestEnv } from "../src/lib/test-guard";

const yes = process.argv.includes("--yes");
const PAGE = 200;

async function main() {
  const db = databaseNameOf(process.env.DATABASE_URL) ?? "알 수 없음";
  const [convs, existing] = await Promise.all([prisma.conversation.count(), prisma.responseMetric.count()]);
  console.log(`DB: ${db}${isTestEnv() ? " (테스트 환경)" : ""} · 대화 ${convs}개 · 기존 지표 ${existing}행`);
  if (!isTestEnv() && !yes) {
    console.error("테스트 DB가 아닙니다. 이 DB의 ResponseMetric을 다시 계산해 덮어쓰려면 --yes를 붙여 다시 실행하세요. 아무것도 바꾸지 않았습니다.");
    process.exit(2);
  }

  let written = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.conversation.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        characterId: true,
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, role: true, retracted: true, content: true, createdAt: true } },
      },
    });
    if (page.length === 0) break;
    for (const c of page) {
      for (const m of pickMetricTargets(c.messages)) {
        await saveResponseMetric({ messageId: m.id, conversationId: c.id, characterId: c.characterId, content: m.content, createdAt: m.createdAt });
        written++;
      }
    }
    cursor = page[page.length - 1].id;
  }
  const stale = await prisma.responseMetric.deleteMany({ where: { message: { retracted: true } } });
  console.log(`완료: ${written}행 기록(덮어쓰기 포함)${stale.count ? ` · 회수된 메시지의 지표 ${stale.count}행 삭제` : ""} · 현재 ${await prisma.responseMetric.count()}행`);
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
