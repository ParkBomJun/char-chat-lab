/**
 * `npm run predeploy` — 배포용 환경변수를 점검한다.
 *   npm run predeploy -- --env-file .env.production          환경변수 + 시드 카드(prisma/seed-data)와 프롬프트 예산
 *   npm run predeploy -- --env-file .env.production --db     위에 더해, 지금 환경의 DATABASE_URL로 DB에 저장된 캐릭터도 점검(읽기만 한다)
 * 운영에서는 seed가 관리자 수정을 덮어쓰지 않으므로(SEED_PRESERVE) DB의 카드가 시드와 다를 수 있다. 그때는 --db를 붙인다.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import pricing from "../src/config/pricing.json";
import { checkDeployEnv, type DeployCard } from "./predeploy-lib";

const { values } = parseArgs({ options: { "env-file": { type: "string" }, db: { type: "boolean" } } });
const env: Record<string, string | undefined> = values["env-file"] ? dotenv.parse(readFileSync(values["env-file"])) : process.env;

const seedDir = path.resolve(__dirname, "../prisma/seed-data");
const cards: DeployCard[] = readdirSync(seedDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const j = JSON.parse(readFileSync(path.join(seedDir, f), "utf8")) as { character: DeployCard["character"]; lorebook?: { id: string; keywords: string[]; content: string; priority: number }[] };
    return { source: `시드(${f})`, character: j.character, lorebook: (j.lorebook ?? []).map((l) => ({ ...l, enabled: true })) };
  });

async function main() {
  if (values.db) {
    // DB 클라이언트는 --db일 때만 읽는다(네트워크 없이 도는 기본 점검에서는 DATABASE_URL이 필요 없다)
    const { prisma } = await import("../src/lib/db");
    const rows = await prisma.character.findMany({
      select: { name: true, persona: true, speechStyle: true, exampleDialog: true, lorebook: { select: { id: true, keywords: true, content: true, priority: true, enabled: true } } },
    });
    for (const { lorebook, ...character } of rows) cards.push({ source: "DB", character, lorebook });
    await prisma.$disconnect();
  }

  const findings = checkDeployEnv(env, { pricedModels: Object.keys(pricing.models), cards });
  const errors = findings.filter((f) => f.level === "error");
  for (const f of findings) console.log(`${f.level === "error" ? "✗ 오류" : "! 경고"}  ${f.message}`);
  console.log(`\n카드 ${cards.length}개의 프롬프트 예산 점검 포함${values.db ? "(DB 포함)" : "(시드만. DB의 카드는 --db)"}`);
  console.log(`${errors.length ? "배포하면 안 됩니다" : "치명적인 문제 없음"} — 오류 ${errors.length}건, 경고 ${findings.length - errors.length}건`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
