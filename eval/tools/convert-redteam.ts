/**
 * 레드팀 표(CSV·TSV·마크다운) → 레드팀 세트 JSON.
 *   npm run eval:convert -- <표 파일> [--out <json>] [--id <세트 id>]
 * 열: id, 범주, 기법, 대화('||'로 턴 구분), 기대 결과(통과 / 입력 차단 / 출력 회수 / 흐름 경고·중단 / 위기 안내).
 * 실제 공격 세트는 저장소에 올리지 않으므로, 출력은 기본적으로 eval/redteam/private/(gitignore)에만 쓴다.
 * 그 밖의 위치에 쓰려면 --allow-public을 줘야 한다(형식 예시 등 무해한 세트용).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { detectFormat, parseTable, tableToSet } from "../lib/convert";

const PRIVATE_DIR = path.resolve(__dirname, "..", "redteam", "private");
const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, id: { type: "string" }, "allow-public": { type: "boolean", default: false } },
});

function main() {
  const input = positionals[0];
  if (!input) throw new Error("사용법: npm run eval:convert -- <표 파일> [--out <json>] [--id <세트 id>] [--allow-public]");
  const text = readFileSync(input, "utf8");
  const stem = path.basename(input).replace(/\.[^.]+$/, "");
  const format = detectFormat(text, input);
  const { set, warnings } = tableToSet(parseTable(text, format), { id: a.id ?? stem, description: "표에서 변환한 비공개 레드팀 세트. 공격 대화 원문이 들어 있으므로 저장소에 올리지 않는다." });

  const out = path.resolve(a.out ?? path.join(PRIVATE_DIR, `${stem}.json`));
  const inPrivate = out === PRIVATE_DIR || out.startsWith(PRIVATE_DIR + path.sep);
  if (!inPrivate && !a["allow-public"]) {
    throw new Error(`출력 위치가 eval/redteam/private/ 밖입니다(${path.relative(process.cwd(), out)}). 실제 세트는 그 안에만 둡니다. 무해한 세트라면 --allow-public을 붙이세요.`);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(set, null, 2) + "\n", "utf8");

  const byExpect = new Map<string, number>();
  for (const c of set.cases) byExpect.set(`${c.expect}${c.expectAt ? `/${c.expectAt}` : ""}`, (byExpect.get(`${c.expect}${c.expectAt ? `/${c.expectAt}` : ""}`) ?? 0) + 1);
  console.log(`변환 완료(${format}): ${set.cases.length}케이스 → ${path.relative(process.cwd(), out)}`);
  console.log(`  공격 ${set.cases.filter((c) => c.label === "attack").length} · 정상 ${set.cases.filter((c) => c.label === "benign").length} · 기대: ${[...byExpect].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
try {
  main();
} catch (e) {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
}
