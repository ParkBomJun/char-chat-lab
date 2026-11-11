/**
 * 토큰 추정 보정 확인(실제 호출 없음, DB 읽기 전용).
 *   npm run tokens:calib [-- --days 30 --model <이름> --min-est 500]
 * UsageLog의 제공사 usage(inputTokens, usageEstimated=false, kind=CHAT)와, 같은 행에 저장된 조립기 추정값(blockTokens.total)을 비교해
 * 조립기의 추정(글자당 1토큰)이 실제 토큰의 몇 배인지 확인한다. 현재 코드의 ESTIMATE_TO_REAL(0.55)이 맞는지 보려는 용도.
 * 주의: 실제 입력에는 제공사가 붙이는 역할 표식 등이 포함돼 짧은 요청일수록 배율이 높게 나온다. 직선 절편(b)이 그 고정 오버헤드다.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { ESTIMATE_TO_REAL, DEFAULT_CACHE_MIN_TOKENS } from "../src/lib/chat/assemble";
import { calibrate, type CalibRow } from "./stats-lib";

const { values: a } = parseArgs({ options: { days: { type: "string", default: "3650" }, model: { type: "string" }, "min-est": { type: "string", default: "0" } } });
const f = (v: number | null, d = 3) => (v === null ? "—" : v.toFixed(d));

async function main() {
  const since = new Date(Date.now() - Math.max(1, Number(a.days) || 3650) * 86400_000);
  const logs = await prisma.usageLog.findMany({
    where: { kind: "CHAT", usageEstimated: false, createdAt: { gte: since }, ...(a.model ? { model: a.model } : {}) },
    select: { model: true, inputTokens: true, cachedInputTokens: true, blockTokens: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const minEst = Number(a["min-est"]) || 0;
  const rows: CalibRow[] = [];
  for (const l of logs) {
    const total = (l.blockTokens as { total?: unknown } | null)?.total;
    if (typeof total === "number" && total >= minEst) rows.push({ model: l.model, input: l.inputTokens, est: total });
  }
  console.log(`대상: CHAT 행 ${logs.length}건 중 조립기 추정값이 있는 ${rows.length}건 (제공사 usage 기준, 추정 행 제외)${a.model ? ` · 모델 ${a.model}` : ""}`);
  if (rows.length === 0) return void console.log("비교할 행이 없습니다.");

  const models = [...new Set(rows.map((r) => r.model))];
  console.log("\n모델                          n   가중배율  중앙값  p10    p90    직선(실제=a×추정+b)");
  for (const m of [...models, "(전체)"]) {
    const c = calibrate(m === "(전체)" ? rows : rows.filter((r) => r.model === m));
    console.log(`${m.padEnd(28)} ${String(c.n).padStart(3)}   ${f(c.weighted).padStart(7)}  ${f(c.median).padStart(6)} ${f(c.p10).padStart(6)} ${f(c.p90).padStart(6)}   ${c.fit ? `a=${f(c.fit.a)}, b=${f(c.fit.b, 0)}` : "—"}`);
  }

  console.log("\n요청별(시간순, 최근 15건): 추정  실제  배율");
  for (const r of rows.slice(-15)) console.log(`  ${String(r.est).padStart(6)} ${String(r.input).padStart(6)}  ${(r.input / r.est).toFixed(3)}`);

  const all = calibrate(rows);
  console.log(`\n현재 코드의 환산 계수 ESTIMATE_TO_REAL = ${ESTIMATE_TO_REAL}, 캐시 최소 길이 ${DEFAULT_CACHE_MIN_TOKENS}토큰`);
  if (all.weighted !== null) {
    const diff = ((all.weighted - ESTIMATE_TO_REAL) / ESTIMATE_TO_REAL) * 100;
    console.log(`실측 가중배율 ${f(all.weighted)} → 현재 계수와 ${diff >= 0 ? "+" : ""}${diff.toFixed(0)}% 차이`);
    console.log(`이 배율이면 breakpoint가 붙는 추정 앞부분 길이: ${Math.ceil(DEFAULT_CACHE_MIN_TOKENS / all.weighted).toLocaleString()}자 이상(계수 ${ESTIMATE_TO_REAL} 기준 ${Math.ceil(DEFAULT_CACHE_MIN_TOKENS / ESTIMATE_TO_REAL).toLocaleString()}자)`);
  }
  if (rows.length < 10) console.log("※ 표본이 10건 미만이라 참고용입니다. 긴 대화(추정 7K자 이상)가 포함돼야 캐시 최소 길이 부근의 배율을 믿을 수 있습니다.");
}
main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
