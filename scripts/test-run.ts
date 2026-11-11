/**
 * 테스트·E2E 전용 실행기. 항상 테스트 DB + mock LLM으로 명령을 실행한다.
 *   tsx scripts/test-run.ts -- next dev -p 3110
 *   tsx scripts/test-run.ts --real -- next dev -p 3110     ← 실제 LLM 호출을 명시적으로 허용(이때만)
 * 개발 환경(.env)의 DATABASE_URL·LLM 키는 이 실행기를 거치면 모두 .env.test 값으로 덮인다.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { databaseNameOf, isTestDatabaseUrl } from "../src/lib/test-guard";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const flags = sep === -1 ? argv : argv.slice(0, sep);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);
const real = flags.includes("--real");

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (cmd.length === 0) fail("실행할 명령이 없습니다. 예: tsx scripts/test-run.ts -- next dev -p 3110");

const envFile = path.resolve(process.cwd(), ".env.test");
if (!existsSync(envFile)) fail(".env.test가 없습니다. `cp .env.test.example .env.test` 후 다시 실행하세요.");

const fromFile = dotenv.parse(readFileSync(envFile));
const env: NodeJS.ProcessEnv = { ...process.env, ...fromFile, APP_ENV: "test" };

if (!isTestDatabaseUrl(env.DATABASE_URL)) {
  fail(`.env.test의 DATABASE_URL이 테스트 DB가 아닙니다(DB 이름 "${databaseNameOf(env.DATABASE_URL) ?? "없음"}", _test로 끝나야 함). 개발 DB 보호를 위해 중단합니다.`);
}

if (real) {
  if (!env.LLM_API_KEY?.trim()) fail("--real인데 .env.test에 LLM_API_KEY가 없습니다(또는 서버의 /admin/settings로 테스트 DB에 저장).");
  env.ALLOW_REAL_LLM = "1";
  delete env.LLM_PROVIDER;
  console.warn("⚠ --real: 실제 LLM API를 호출합니다(비용 발생). 테스트 DB: " + databaseNameOf(env.DATABASE_URL));
} else {
  env.LLM_API_KEY = "";
  env.LLM_PROVIDER = "mock";
  delete env.ALLOW_REAL_LLM;
  console.log(`테스트 모드: DB=${databaseNameOf(env.DATABASE_URL)} · LLM=mock (실제 호출 차단)`);
}

const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
