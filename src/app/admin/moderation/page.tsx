import Link from "next/link";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 50;
const STAGES = ["INPUT", "OUTPUT_STREAM", "OUTPUT_FINAL", "CONVERSATION"] as const;
const VERDICTS = ["ALLOW", "BLOCK", "ERROR"] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends string>(v: string, allowed: readonly T[]): T | undefined => allowed.find((a) => a === v);

export default async function ModerationLog(props: PageProps<"/admin/moderation">) {
  const sp = await props.searchParams;
  const stage = pick(one(sp.stage), STAGES);
  const verdict = pick(one(sp.verdict), VERDICTS);
  const category = one(sp.category).trim().slice(0, 40);
  const showTurns = one(sp.turns) === "1";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);

  const and: Prisma.ModerationEventWhereInput[] = [];
  if (stage) and.push({ stage });
  if (verdict) and.push({ verdict });
  if (category) and.push({ category });
  // 턴 점수 행(category=turn)은 기본 숨김. NULL 카테고리 행은 남겨야 하므로 OR로 표현한다.
  if (!showTurns) and.push({ OR: [{ category: null }, { category: { not: "turn" } }] });
  const where: Prisma.ModerationEventWhereInput = and.length ? { AND: and } : {};

  const [rows, total] = await Promise.all([
    prisma.moderationEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.moderationEvent.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | number | undefined> = { stage, verdict, category, turns: showTurns ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(cur)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/admin/moderation?${p.toString()}`;
  };

  return (
    <>
      <h1>안전 판정 로그</h1>
      <p className="who">사용자 메시지 원문은 저장하지 않습니다(단계·카테고리·점수·조치만).</p>
      <form className="filters" method="get">
        <label>단계
          <select name="stage" defaultValue={stage ?? ""}>
            <option value="">전체</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>판정
          <select name="verdict" defaultValue={verdict ?? ""}>
            <option value="">전체</option>
            {VERDICTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>카테고리 <input name="category" defaultValue={category} placeholder="예: sexual" /></label>
        <label className="check"><input type="checkbox" name="turns" value="1" defaultChecked={showTurns} /> 턴 점수 행 포함</label>
        <button type="submit">필터 적용</button>
      </form>

      <p className="who">{total.toLocaleString("ko-KR")}건 · {page}/{pages} 페이지</p>
      <table className="admin-table">
        <thead>
          <tr><th>시각(KST)</th><th>대화</th><th>단계</th><th>층</th><th>판정</th><th>카테고리</th><th>점수</th><th>조치</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8}>조건에 맞는 기록이 없습니다.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className={r.verdict === "BLOCK" ? "row-block" : r.verdict === "ERROR" ? "row-error" : ""}>
              <td>{r.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
              <td title={r.conversationId}>{r.conversationId.slice(-6)}</td>
              <td>{r.stage}</td><td>{r.layer}</td><td>{r.verdict}</td>
              <td>{r.category ?? "—"}</td><td>{r.score === null ? "—" : r.score.toFixed(2)}</td><td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pager">
        {page > 1 && <Link href={qs({ page: page - 1 })}>← 이전</Link>}
        {page < pages && <Link href={qs({ page: page + 1 })}>다음 →</Link>}
      </p>
    </>
  );
}
