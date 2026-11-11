/** `npm run predeploy` — 배포용 환경변수를 점검한다. 사용: npm run predeploy -- --env-file .env.production */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import pricing from "../src/config/pricing.json";
import { checkDeployEnv } from "./predeploy-lib";

const { values } = parseArgs({ options: { "env-file": { type: "string" } } });
const env: Record<string, string | undefined> = values["env-file"] ? dotenv.parse(readFileSync(values["env-file"])) : process.env;

const findings = checkDeployEnv(env, { pricedModels: Object.keys(pricing.models) });
const errors = findings.filter((f) => f.level === "error");
for (const f of findings) console.log(`${f.level === "error" ? "✗ 오류" : "! 경고"}  ${f.message}`);
console.log(`\n${errors.length ? "배포하면 안 됩니다" : "치명적인 문제 없음"} — 오류 ${errors.length}건, 경고 ${findings.length - errors.length}건`);
process.exit(errors.length ? 1 : 0);
