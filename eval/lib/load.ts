import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { characterFileSchema, redteamSetSchema, scenarioSchema, type CharacterFile, type RedteamSet, type Scenario } from "./schema";

export const EVAL_DIR = path.resolve(__dirname, "..");

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${path.relative(process.cwd(), file)} 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseOrThrow<T>(file: string, r: { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } }): T {
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.map(String).join(".") || "(루트)"}: ${i.message}`).join("\n  ");
  throw new Error(`${path.relative(process.cwd(), file)} 형식 오류:\n  ${msg}`);
}

export function loadCharacter(name: string): CharacterFile {
  const file = path.join(EVAL_DIR, "characters", `${name}.json`);
  return parseOrThrow(file, characterFileSchema.safeParse(readJson(file)));
}

const jsonFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));

export function loadScenarios(only?: string): Scenario[] {
  const all = jsonFiles(path.join(EVAL_DIR, "scenarios")).map((f) => parseOrThrow(f, scenarioSchema.safeParse(readJson(f))));
  const picked = only ? all.filter((s) => s.id === only) : all;
  if (only && picked.length === 0) throw new Error(`시나리오 "${only}"를 찾을 수 없습니다. 있는 것: ${all.map((s) => s.id).join(", ")}`);
  return picked;
}

/** 레드팀 세트. file을 주면 그 파일만, 없으면 eval/redteam/의 모든 세트(예시 example.json은 제외). */
export function loadRedteamSets(file?: string): RedteamSet[] {
  const files = file ? [path.resolve(file)] : jsonFiles(path.join(EVAL_DIR, "redteam")).filter((f) => path.basename(f) !== "example.json");
  return files.map((f) => parseOrThrow(f, redteamSetSchema.safeParse(readJson(f))));
}
