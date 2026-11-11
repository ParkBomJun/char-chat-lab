import Link from "next/link";
import { getDashboard, fmtCost, fmtInt, fmtMs, fmtPct, periodStart } from "@/lib/admin/stats";
import { getQuality } from "@/lib/admin/quality";
import { loadConfig } from "@/lib/config";
import { SCRIPT_LABEL } from "@/lib/quality/metrics";
import { MANY_PARAGRAPHS_OVER } from "@/lib/quality/summary";

const PERIODS = [1, 7, 30];

export default async function AdminHome(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  const raw = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = PERIODS.includes(raw) ? raw : 7;
  const cfg = loadConfig();
  const rawChar = Array.isArray(sp.character) ? sp.character[0] : sp.character;
  const [d, q0] = await Promise.all([getDashboard(days), getQuality(periodStart(days), null, cfg.quality.minHangulRatio)]);
  // 캐릭터 필터는 실제로 있는 id일 때만 적용한다
  const characterId = q0.characters.some((c) => c.id === rawChar) ? (rawChar as string) : null;
  const q = characterId ? await getQuality(periodStart(days), characterId, cfg.quality.minHangulRatio) : q0;
  const qs = q.summary;
  const charQuery = characterId ? `&character=${encodeURIComponent(characterId)}` : "";
  const unpriced = d.totalCost === 0 && d.rows.length > 0;

  return (
    <>
      <h1>사용량·비용 요약</h1>
      <p className="period">
        기간(KST):{" "}
        {PERIODS.map((p) => (
          <Link key={p} href={`/admin?days=${p}${charQuery}`} className={p === days ? "on" : ""}>
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
        <Stat
          label={d.actualCalls > 0 ? "비용 합계(실제 청구 우선)" : "추정 비용 합계"}
          value={fmtCost(d.totalCost)}
          sub={
            d.actualCalls > 0
              ? `실제 청구액 기록 ${d.actualCalls}/${d.totalCalls}건 · 단가표 추정 ${fmtCost(d.totalEstCost)}`
              : unpriced ? "단가가 0이거나 미설정" : undefined
          }
        />
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
          <tr><th>종류</th><th>모델</th><th>호출</th><th>입력 토큰</th><th>캐시 토큰</th><th>출력 토큰</th><th>비용</th><th>단가표 추정</th></tr>
        </thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={8}>기록이 없습니다.</td></tr>}
          {d.rows.map((r) => (
            <tr key={`${r.kind}-${r.model}`}>
              <td>{r.kind}</td><td>{r.model}</td><td>{fmtInt(r.calls)}</td>
              <td>{fmtInt(r.input)}</td><td>{fmtInt(r.cached)}</td><td>{fmtInt(r.output)}</td><td>{fmtCost(r.cost)}{r.actualRows > 0 && r.actualRows < r.calls ? " *" : ""}</td><td>{fmtCost(r.estCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="period">비용은 제공사가 알려준 실제 청구액(usage.cost)이 있는 호출은 그 값을, 없으면 단가표 추정값을 씁니다. * = 일부 호출만 실제 청구액이 기록됨.</p>

      <h2>일별 (KST)</h2>
      <table className="admin-table">
        <thead><tr><th>날짜</th><th>대화 호출</th><th>비용</th><th>캐시 적중률</th></tr></thead>
        <tbody>
          {d.daily.length === 0 && <tr><td colSpan={4}>기록이 없습니다.</td></tr>}
          {d.daily.map((r) => (
            <tr key={r.day}><td>{r.day}</td><td>{fmtInt(r.chats)}</td><td>{fmtCost(r.cost)}</td><td>{fmtPct(r.hit)}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="quality">응답 품질</h2>
      <p className="who">
        캐릭터 응답의 글자만 보고 계산한 지표입니다(모델 호출 없음). 기록용이며 이 값으로 응답을 차단하거나 다시 만들지 않습니다. 회수된 응답과 첫 인사는 제외합니다. 기간은 위에서 고른 것과 같습니다.
      </p>
      <form className="filters" action="/admin#quality" method="get">
        <input type="hidden" name="days" value={days} />
        <label>
          캐릭터
          <select name="character" defaultValue={characterId ?? ""}>
            <option value="">전체</option>
            {q.characters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <button type="submit">적용</button>
      </form>
      {qs.n === 0 ? (
        <p className="who">이 조건에 해당하는 응답 지표가 없습니다. 이전 메시지는 <code>npm run metrics:backfill</code>로 계산할 수 있습니다.</p>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="집계한 응답" value={fmtInt(qs.n)} sub={q.capped ? "행이 많아 최근 것만 집계" : undefined} />
            <Stat
              label="외국어 섞임 비율"
              value={fmtPct(qs.belowHangul.rate)}
              sub={`한글 비율 ${Math.round(qs.minHangulRatio * 100)}% 미만 ${fmtInt(qs.belowHangul.k)}건 (QUALITY_MIN_HANGUL_RATIO)`}
            />
            <Stat
              label="한글·라틴 외 문자 섞임"
              value={fmtPct(qs.foreign.rate)}
              sub={Object.entries(qs.foreign.byScript).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${SCRIPT_LABEL[k] ?? k} ${v}`).join(" · ") || "없음"}
            />
            <Stat label="평균 길이" value={qs.avgLength === null ? "—" : `${fmtInt(Math.round(qs.avgLength))}자`} />
            <Stat label={`문단 ${MANY_PARAGRAPHS_OVER}개 초과 응답`} value={fmtPct(qs.manyParagraphs.rate)} sub={`${fmtInt(qs.manyParagraphs.k)}건`} />
            <Stat label="질문으로 끝나는 응답" value={fmtPct(qs.endsWithQuestion.rate)} sub={`${fmtInt(qs.endsWithQuestion.k)}건`} />
          </div>
          <table className="admin-table">
            <thead><tr><th>자주 나온 행동 묘사(괄호 안 문구) 상위 5개</th><th>나온 응답 수</th><th>비율</th></tr></thead>
            <tbody>
              {qs.topActions.length === 0 && <tr><td colSpan={3}>괄호 안 행동 묘사가 없습니다.</td></tr>}
              {qs.topActions.map((a) => (
                <tr key={a.phrase}><td>{a.phrase}</td><td>{fmtInt(a.count)}</td><td>{fmtPct(a.rate)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="period">비율 = 그 문구가 한 번이라도 나온 응답 ÷ 집계한 응답. 행동 묘사가 하나라도 있는 응답은 {fmtPct(qs.withAction.rate)}입니다.</p>
        </>
      )}

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
