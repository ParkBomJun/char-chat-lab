/**
 * 수동 판정 리포트.
 *   npm run eval:judge -- <판정 CSV> [<판정 CSV> ...] [--out <md 파일>] [--allow-public]
 * 앱 안전 켬 실행의 CSV와 끔 실행의 CSV를 함께 넘기면 켬/끔별 유해 응답 도달률과 쌍 비교를 낸다.
 * CSV는 --private 실행이 만든 eval/redteam/private/results/<실행>.judge.csv 이고, '판정' 칸을 사람이 채운 것이다.
 * 출력에는 케이스 id·범주·기법과 집계만 있고 대화·응답 원문은 없다. 기본 출력 위치는 private/results/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseJudgeCsv, renderHarmReport, summarizeHarm } from "../lib/judge";

const PRIVATE_RESULTS = path.resolve(__dirname, "..", "redteam", "private", "results");
const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, "allow-public": { type: "boolean", default: false } } });

function main() {
  if (positionals.length === 0) throw new Error("사용법: npm run eval:judge -- <판정 CSV> [<판정 CSV> ...] [--out <md 파일>]");
  const rows = positionals.flatMap((f) => {
    try {
      return parseJudgeCsv(readFileSync(f, "utf8"), f);
    } catch (e) {
      throw new Error(`${path.relative(process.cwd(), f)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const rep = summarizeHarm(rows);
  const now = new Date();
  const md = renderHarmReport(rep, { sources: positionals.map((f) => path.basename(f)), generatedKst: now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }) });

  const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const out = path.resolve(a.out ?? path.join(PRIVATE_RESULTS, `judged-${date}.md`));
  if (!(out === PRIVATE_RESULTS || out.startsWith(PRIVATE_RESULTS + path.sep) || out.startsWith(path.dirname(PRIVATE_RESULTS) + path.sep)) && !a["allow-public"]) {
    throw new Error(`출력 위치가 eval/redteam/private/ 밖입니다. 이 문서에는 원문은 없지만 케이스 id·결과가 있어 비공개 폴더에 둡니다. 다른 곳에 쓰려면 --allow-public을 붙이세요.`);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, md, "utf8");

  for (const m of rep.modes) {
    const t = m.total;
    console.log(
      `앱 안전 ${m.mode}: 공격 ${t.n}건 · 유해 도달 ${t.harmful} · 거절·전환 ${t.refusal} · 해당 없음 ${t.na} · 미도달(자동) ${t.autoNotReached} · 미판정 ${t.unjudged} → 유해 응답 도달률 ${
        t.harmRate.value === null ? "—(판정 없음)" : `${(t.harmRate.value * 100).toFixed(1)}% (${t.harmRate.k}/${t.harmRate.n})`
      }`,
    );
  }
  if (rep.paired) console.log(`쌍 비교 ${rep.paired.n}건: 앱 안전 덕에 막힘 ${rep.paired.savedByApp} · 켬에서도 도달 ${rep.paired.harmfulBoth} · 켬에서만 도달 ${rep.paired.harmfulOnlyOn} · 미판정으로 제외 ${rep.paired.undecided}`);
  const unjudged = rep.modes.reduce((n, m) => n + m.total.unjudged, 0);
  if (unjudged) console.log(`⚠ 미판정 ${unjudged}건이 있습니다. 상한 값을 함께 보세요.`);
  console.log(`리포트: ${path.relative(process.cwd(), out)}`);
}
try {
  main();
} catch (e) {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
}
