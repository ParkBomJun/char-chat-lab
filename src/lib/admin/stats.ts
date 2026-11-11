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
        _sum: { inputTokens: true, cachedInputTokens: true, outputTokens: true },
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

  // 비용: 제공사가 준 실제 청구액(actualCost)이 있으면 그것을, 없으면 단가표 추정(estCost)을 쓴다(행 단위로 coalesce).
  const costRows = await prisma.$queryRaw<{ kind: string; model: string; cost: number; est: number; actual_rows: number }[]>(Prisma.sql`
    SELECT kind::text AS kind, model,
           coalesce(sum(coalesce("actualCost", "estCost")), 0)::float AS cost,
           coalesce(sum("estCost"), 0)::float AS est,
           (count("actualCost"))::int AS actual_rows
    FROM "UsageLog" WHERE "createdAt" >= ${since}
    GROUP BY kind, model`);
  const costOf = new Map(costRows.map((c) => [`${c.kind}\u0000${c.model}`, c]));

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
           coalesce(sum(coalesce("actualCost", "estCost")), 0)::float AS cost,
           coalesce(sum("inputTokens") FILTER (WHERE kind = 'CHAT' AND NOT "usageEstimated"), 0)::float AS input,
           coalesce(sum("cachedInputTokens") FILTER (WHERE kind = 'CHAT' AND NOT "usageEstimated"), 0)::float AS cached
    FROM "UsageLog" WHERE "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1 DESC`);

  const rows = byKindModel.map((r) => {
    const c = costOf.get(`${r.kind}\u0000${r.model}`);
    return {
      kind: r.kind,
      model: r.model,
      calls: r._count._all,
      input: r._sum.inputTokens ?? 0,
      cached: r._sum.cachedInputTokens ?? 0,
      output: r._sum.outputTokens ?? 0,
      cost: c?.cost ?? 0,
      /** 단가표 기반 추정(비교용) */
      estCost: c?.est ?? 0,
      /** 제공사 실제 청구액이 기록된 호출 수 */
      actualRows: c?.actual_rows ?? 0,
    };
  });
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const totalEstCost = rows.reduce((a, r) => a + r.estCost, 0);
  const actualCalls = rows.reduce((a, r) => a + r.actualRows, 0);
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
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
    totalEstCost,
    actualCalls,
    totalCalls,
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
