import Link from "next/link";
import { getDashboard, fmtCost, fmtInt, fmtMs, fmtPct, periodStart } from "@/lib/admin/stats";
import { getQuality } from "@/lib/admin/quality";
import { loadConfig } from "@/lib/config";
import { SCRIPT_LABEL } from "@/lib/quality/metrics";
import { MANY_PARAGRAPHS_OVER } from "@/lib/quality/summary";
import { Verdict } from "@/components/admin/Verdict";

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

  const num = "num";
  return (
    <>
      <section className="sec">
        <div className="sec-head">
          <h1 className="h1">사용량·비용 요약</h1>
          <div className="seg" role="group" aria-label="기간(KST)">
            {PERIODS.map((p) => (
              <Link key={p} href={`/admin?days=${p}${charQuery}`} aria-current={p === days ? "true" : undefined}>
                {p === 1 ? "오늘" : `최근 ${p}일`}
              </Link>
            ))}
          </div>
        </div>
        <p className="small">
          {d.since.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 이후(KST) · 일일 한도 {cfg.dailyMessageLimit}개/인 · 실사용자 데이터가 아니라 개발·시뮬레이션 데이터일 수 있습니다.
        </p>
        <div className="stats">
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
            label="캐시 재사용(읽기만) · 대화"
            value={`${fmtInt(d.cache.reused)}건 · ${fmtPct(d.cache.reuseRate)}`}
            sub={`생성(쓰기 발생) ${fmtInt(d.cache.created)}건 · ${fmtPct(d.cache.createRate)} / 캐시 없음 ${fmtInt(d.cache.none)}건${d.cache.unknown ? ` / 구분 불가 ${fmtInt(d.cache.unknown)}건(쓰기 토큰 기록 전)` : ""}`}
          />
          <Stat
            label="캐시 토큰 비중(대화)"
            value={fmtPct(d.cache.rate)}
            sub={`입력 토큰 중 캐시 토큰. 생성 요청도 포함되므로 재사용 비율이 아님 · usage 기준 ${d.cache.exactRows}건, 추정 행 ${d.cache.estimatedRows}건 제외`}
          />
          <Stat label="첫 토큰 p50 / p95" value={`${fmtMs(d.latency.p50Ttft)} / ${fmtMs(d.latency.p95Ttft)}`} sub={`대화 ${d.latency.n}건`} />
          <Stat label="전체 응답 평균 / p95" value={`${fmtMs(d.latency.avgTotal)} / ${fmtMs(d.latency.p95Total)}`} />
        </div>
        {unpriced && (
          <p className="warn" role="status">
            추정 비용이 0입니다. <code>src/config/pricing.json</code>에 모델 단가를 입력하면 반영됩니다.
          </p>
        )}
      </section>

      <section className="sec">
        <h2 className="h2">종류·모델별 사용량</h2>
        <div className="tbl-wrap">
          <table className="admin-table" style={{ minWidth: 720 }}>
            <thead>
              <tr><th scope="col">종류</th><th scope="col">모델</th><th scope="col" className={num}>호출</th><th scope="col" className={num}>입력 토큰</th><th scope="col" className={num}>캐시 토큰</th><th scope="col" className={num}>출력 토큰</th><th scope="col" className={num}>비용</th><th scope="col" className={num}>단가표 추정</th></tr>
            </thead>
            <tbody>
              {d.rows.length === 0 && <tr><td colSpan={8}>기록이 없습니다.</td></tr>}
              {d.rows.map((r) => (
                <tr key={`${r.kind}-${r.model}`}>
                  <td><b>{r.kind}</b></td><td className="dim">{r.model}</td><td className={num}>{fmtInt(r.calls)}</td>
                  <td className={num}>{fmtInt(r.input)}</td><td className={num}>{fmtInt(r.cached)}</td><td className={num}>{fmtInt(r.output)}</td><td className={num}>{fmtCost(r.cost)}{r.actualRows > 0 && r.actualRows < r.calls ? " *" : ""}</td><td className={num}>{fmtCost(r.estCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note-s">비용은 제공사가 알려준 실제 청구액(usage.cost)이 있는 호출은 그 값을, 없으면 단가표 추정값을 씁니다. * = 일부 호출만 실제 청구액이 기록됨.</p>
        <p className="note-s">캐시: &quot;생성&quot;은 캐시를 처음 만든 요청(그 토큰에 읽기+쓰기 단가), &quot;재사용&quot;은 유지 시간 안에 같은 앞부분이 다시 와서 읽기 단가만 낸 요청입니다. 비율의 분모는 생성+재사용+캐시 없음입니다.</p>
      </section>

      <div className="split">
        <section className="sec">
          <div className="sec-head">
            <h2 className="h2">안전 판정 요약</h2>
            <Link href="/admin/moderation" className="more">판정 로그 보기</Link>
          </div>
          <div className="tbl-wrap">
            <table className="admin-table" style={{ minWidth: 420 }}>
              <thead><tr><th scope="col">단계</th><th scope="col">판정</th><th scope="col">조치</th><th scope="col" className={num}>건수</th></tr></thead>
              <tbody>
                {d.moderation.length === 0 && <tr><td colSpan={4}>기록이 없습니다.</td></tr>}
                {d.moderation.map((m) => (
                  <tr key={`${m.stage}-${m.verdict}-${m.action}`}>
                    <td>{m.stage}</td><td><Verdict v={m.verdict} /></td><td className={m.action === "none" ? "dim" : undefined}>{m.action === "none" ? m.action : <b>{m.action}</b>}</td><td className={num}>{fmtInt(m.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note-s">대화 상태: {Object.entries(d.convByStatus).map(([k, v]) => `${k} ${v}`).join(" · ") || "대화 없음"}</p>
        </section>
        <section className="sec">
          <h2 className="h2">일별 (KST)</h2>
          <div className="tbl-wrap">
            <table className="admin-table" style={{ minWidth: 300 }}>
              <thead><tr><th scope="col">날짜</th><th scope="col" className={num}>대화 호출</th><th scope="col" className={num}>비용</th><th scope="col" className={num}>캐시 토큰 비중</th></tr></thead>
              <tbody>
                {d.daily.length === 0 && <tr><td colSpan={4}>기록이 없습니다.</td></tr>}
                {d.daily.map((r) => (
                  <tr key={r.day}><td>{r.day}</td><td className={num}>{fmtInt(r.chats)}</td><td className={num}>{fmtCost(r.cost)}</td><td className={num}>{fmtPct(r.hit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="sec" id="quality">
        <div className="sec-head">
          <div>
            <h2 className="h2">응답 품질</h2>
            <p className="note-s">
              캐릭터 응답의 글자만 보고 계산한 지표입니다(모델 호출 없음). 기록용이며 이 값으로 응답을 차단하거나 다시 만들지 않습니다. 회수된 응답과 첫 인사는 제외합니다. 기간은 위에서 고른 것과 같습니다.
            </p>
          </div>
          <form className="sel" action="/admin#quality" method="get">
            <input type="hidden" name="days" value={days} />
            <label htmlFor="quality-character">캐릭터</label>
            <select id="quality-character" name="character" defaultValue={characterId ?? ""}>
              <option value="">전체</option>
              {q.characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="submit" className="btn line">적용</button>
          </form>
        </div>
        {qs.n === 0 ? (
          <p className="small">이 조건에 해당하는 응답 지표가 없습니다. 이전 메시지는 <code>npm run metrics:backfill</code>로 계산할 수 있습니다.</p>
        ) : (
          <>
            <div className="stats three">
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
            <div className="tbl-wrap">
              <table className="admin-table" style={{ minWidth: 420 }}>
                <thead><tr><th scope="col">자주 나온 행동 묘사(괄호 안 문구) 상위 5개</th><th scope="col" className={num}>나온 응답 수</th><th scope="col" className={num}>비율</th></tr></thead>
                <tbody>
                  {qs.topActions.length === 0 && <tr><td colSpan={3}>괄호 안 행동 묘사가 없습니다.</td></tr>}
                  {qs.topActions.map((a) => (
                    <tr key={a.phrase}><td>{a.phrase}</td><td className={num}>{fmtInt(a.count)}</td><td className={num}>{fmtPct(a.rate)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note-s">비율 = 그 문구가 한 번이라도 나온 응답 ÷ 집계한 응답. 행동 묘사가 하나라도 있는 응답은 {fmtPct(qs.withAction.rate)}입니다.</p>
          </>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
