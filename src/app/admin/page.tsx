import Link from "next/link";
import { getDashboard, fmtCost, fmtInt, fmtMs, fmtPct } from "@/lib/admin/stats";
import { loadConfig } from "@/lib/config";

const PERIODS = [1, 7, 30];

export default async function AdminHome(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  const raw = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = PERIODS.includes(raw) ? raw : 7;
  const d = await getDashboard(days);
  const cfg = loadConfig();
  const unpriced = d.totalCost === 0 && d.rows.length > 0;

  return (
    <>
      <h1>사용량·비용 요약</h1>
      <p className="period">
        기간(KST):{" "}
        {PERIODS.map((p) => (
          <Link key={p} href={`/admin?days=${p}`} className={p === days ? "on" : ""}>
            {p === 1 ? "오늘" : `최근 ${p}일`}
          </Link>
        ))}
      </p>
      <p className="who">
        {d.since.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 이후 · 실사용자 데이터가 아니라 개발·시뮬레이션 데이터일 수 있습니다.
      </p>

      <div className="stat-grid">
        <Stat label="사용자 메시지" value={fmtInt(d.userMessages)} />
        <Stat label="새 대화" value={fmtInt(d.conversations)} />
        <Stat label="활성 사용자 / 전체" value={`${d.activeUsers} / ${d.totalUsers}`} />
        <Stat label="추정 비용 합계" value={fmtCost(d.totalCost)} sub={unpriced ? "단가가 0이거나 미설정" : undefined} />
        <Stat
          label="캐시 적중률(대화)"
          value={fmtPct(d.cache.rate)}
          sub={`제공사 usage 기준 ${d.cache.exactRows}건 · 추정 행 ${d.cache.estimatedRows}건 제외`}
        />
        <Stat label="첫 토큰 p50 / p95" value={`${fmtMs(d.latency.p50Ttft)} / ${fmtMs(d.latency.p95Ttft)}`} sub={`대화 ${d.latency.n}건`} />
        <Stat label="전체 응답 평균 / p95" value={`${fmtMs(d.latency.avgTotal)} / ${fmtMs(d.latency.p95Total)}`} />
        <Stat label="일일 한도" value={`${cfg.dailyMessageLimit}개/인`} />
      </div>
      {unpriced && (
        <p className="error">
          추정 비용이 0입니다. <code>src/config/pricing.json</code>에 모델 단가를 입력하면 반영됩니다.
        </p>
      )}

      <h2>종류·모델별 사용량</h2>
      <table className="admin-table">
        <thead>
          <tr><th>종류</th><th>모델</th><th>호출</th><th>입력 토큰</th><th>캐시 토큰</th><th>출력 토큰</th><th>추정 비용</th></tr>
        </thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={7}>기록이 없습니다.</td></tr>}
          {d.rows.map((r) => (
            <tr key={`${r.kind}-${r.model}`}>
              <td>{r.kind}</td><td>{r.model}</td><td>{fmtInt(r.calls)}</td>
              <td>{fmtInt(r.input)}</td><td>{fmtInt(r.cached)}</td><td>{fmtInt(r.output)}</td><td>{fmtCost(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>일별 (KST)</h2>
      <table className="admin-table">
        <thead><tr><th>날짜</th><th>대화 호출</th><th>추정 비용</th><th>캐시 적중률</th></tr></thead>
        <tbody>
          {d.daily.length === 0 && <tr><td colSpan={4}>기록이 없습니다.</td></tr>}
          {d.daily.map((r) => (
            <tr key={r.day}><td>{r.day}</td><td>{fmtInt(r.chats)}</td><td>{fmtCost(r.cost)}</td><td>{fmtPct(r.hit)}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>안전 판정 요약</h2>
      <p className="who">
        대화 상태: {Object.entries(d.convByStatus).map(([k, v]) => `${k} ${v}`).join(" · ") || "대화 없음"} · 상세는{" "}
        <Link href="/admin/moderation">판정 로그</Link>
      </p>
      <table className="admin-table">
        <thead><tr><th>단계</th><th>판정</th><th>조치</th><th>건수</th></tr></thead>
        <tbody>
          {d.moderation.length === 0 && <tr><td colSpan={4}>기록이 없습니다.</td></tr>}
          {d.moderation.map((m) => (
            <tr key={`${m.stage}-${m.verdict}-${m.action}`}><td>{m.stage}</td><td>{m.verdict}</td><td>{m.action}</td><td>{fmtInt(m.n)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="who">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="who">{sub}</div>}
    </div>
  );
}
