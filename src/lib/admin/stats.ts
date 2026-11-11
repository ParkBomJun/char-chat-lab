import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { kstDayStart } from "@/lib/kst";

/** 캐시 적중률 = 캐시된 입력 토큰 / 전체 입력 토큰. 입력이 없으면 null. */
export function cacheHitRate(cached: number, input: number): number | null {
  return input > 0 ? cached / input : null;
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
export const fmtCost = (v: number) => (v === 0 ? "$0" : `$${v.toFixed(v < 0.01 ? 6 : 4)}`);
export const fmtMs = (v: number | null) => (v === null || Number.isNaN(v) ? "—" : `${Math.round(v)}ms`);
export const fmtInt = (v: number) => v.toLocaleString("ko-KR");

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

/** 조회 구간의 시작: KST 오늘 자정에서 (days-1)일 전. days=1이면 오늘만. */
export function periodStart(days: number, now: Date = new Date()): Date {
  return new Date(kstDayStart(now).getTime() - (days - 1) * 24 * 60 * 60 * 1000);
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard(days: number, now: Date = new Date()) {
  const since = periodStart(days, now);
  const inRange = { createdAt: { gte: since } };

  const [byKindModel, exactChat, estimatedRows, userMessages, conversations, totalUsers, activeUsers, convByStatus, modGroups] =
    await Promise.all([
      prisma.usageLog.groupBy({
        by: ["kind", "model"],
        where: inRange,
        _sum: { inputTokens: true, cachedInputTokens: true, outputTokens: true, estCost: true },
        _count: { _all: true },
      }),
      // 적중률은 제공사가 usage를 준 행만으로 계산한다(추정 행은 캐시 토큰을 모르므로 0으로 들어가 편향시킨다)
      prisma.usageLog.aggregate({
        where: { ...inRange, kind: "CHAT", usageEstimated: false },
        _sum: { inputTokens: true, cachedInputTokens: true },
        _count: { _all: true },
      }),
      prisma.usageLog.count({ where: { ...inRange, usageEstimated: true } }),
      prisma.message.count({ where: { ...inRange, role: "USER" } }),
      prisma.conversation.count({ where: inRange }),
      prisma.user.count(),
      prisma.usageLog.groupBy({ by: ["userId"], where: inRange }),
      prisma.conversation.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.moderationEvent.groupBy({
        by: ["stage", "verdict", "action"],
        // category가 NULL인 행도 포함해야 하므로 NOT(category='turn')이 아니라 OR로 쓴다(SQL의 NULL 비교 함정)
        where: { ...inRange, OR: [{ category: null }, { category: { not: "turn" } }] },
        _count: { _all: true },
      }),
    ]);

  const latency = await prisma.$queryRaw<
    { n: number; avg_ttft: number | null; p50_ttft: number | null; p95_ttft: number | null; avg_total: number | null; p95_total: number | null }[]
  >(Prisma.sql`
    SELECT count(*)::int AS n,
           avg("ttftMs")::float AS avg_ttft,
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY "ttftMs")::float AS p50_ttft,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY "ttftMs")::float AS p95_ttft,
           avg("totalMs")::float AS avg_total,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs")::float AS p95_total
    FROM "UsageLog" WHERE kind = 'CHAT' AND "createdAt" >= ${since}`);

  // createdAt은 UTC로 저장된 timestamp(타임존 없음) → UTC로 해석한 뒤 KST로 변환해 날짜를 자른다
  const daily = await prisma.$queryRaw<{ day: string; chats: number; cost: number; input: number; cached: number }[]>(Prisma.sql`
    SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS day,
           (count(*) FILTER (WHERE kind = 'CHAT'))::int AS chats,
           coalesce(sum("estCost"), 0)::float AS cost,
           coalesce(sum("inputTokens") FILTER (WHERE kind = 'CHAT' AND NOT "usageEstimated"), 0)::float AS input,
           coalesce(sum("cachedInputTokens") FILTER (WHERE kind = 'CHAT' AND NOT "usageEstimated"), 0)::float AS cached
    FROM "UsageLog" WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1 DESC`);

  const rows = byKindModel.map((r) => ({
    kind: r.kind,
    model: r.model,
    calls: r._count._all,
    input: r._sum.inputTokens ?? 0,
    cached: r._sum.cachedInputTokens ?? 0,
    output: r._sum.outputTokens ?? 0,
    cost: num(r._sum.estCost),
  }));
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const exactInput = exactChat._sum.inputTokens ?? 0;
  const exactCached = exactChat._sum.cachedInputTokens ?? 0;
  const l = latency[0];

  return {
    since,
    days,
    userMessages,
    conversations,
    totalUsers,
    activeUsers: activeUsers.length,
    totalCost,
    rows,
    cache: { rate: cacheHitRate(exactCached, exactInput), input: exactInput, cached: exactCached, exactRows: exactChat._count._all, estimatedRows },
    latency: {
      n: l?.n ?? 0,
      avgTtft: l?.avg_ttft ?? null,
      p50Ttft: l?.p50_ttft ?? null,
      p95Ttft: l?.p95_ttft ?? null,
      avgTotal: l?.avg_total ?? null,
      p95Total: l?.p95_total ?? null,
    },
    daily: daily.map((d) => ({ ...d, hit: cacheHitRate(d.cached, d.input) })),
    convByStatus: Object.fromEntries(convByStatus.map((c) => [c.status, c._count._all])) as Record<string, number>,
    moderation: modGroups
      .map((m) => ({ stage: m.stage, verdict: m.verdict, action: m.action, n: m._count._all }))
      .sort((a, b) => b.n - a.n),
  };
}
