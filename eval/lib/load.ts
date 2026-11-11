import { existsSync, readFileSync, readdirSync } from "node:fs";
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

export const PRIVATE_DIR = path.join(EVAL_DIR, "redteam", "private");
export const isPrivatePath = (file: string) => {
  const f = path.resolve(file);
  return f === PRIVATE_DIR || f.startsWith(PRIVATE_DIR + path.sep);
};

export type LoadedSet = { set: RedteamSet; isPrivate: boolean };

/**
 * 레드팀 세트. file을 주면 그 파일만, 없으면 eval/redteam/의 공개 세트(예시 example.json 제외).
 * includePrivate면 eval/redteam/private/*.json(실제 세트, gitignore)도 함께 읽는다. private 안의 파일은 isPrivate로 표시된다.
 */
export function loadRedteamSetsTagged(file?: string | readonly string[], includePrivate = false): LoadedSet[] {
  const given = file === undefined ? [] : typeof file === "string" ? [file] : [...file];
  const files = given.length
    ? given.map((f) => path.resolve(f))
    : [
        ...jsonFiles(path.join(EVAL_DIR, "redteam")).filter((f) => path.basename(f) !== "example.json"),
        ...(includePrivate && existsSync(PRIVATE_DIR) ? jsonFiles(PRIVATE_DIR) : []),
      ];
  return files.map((f) => ({ set: parseOrThrow(f, redteamSetSchema.safeParse(readJson(f))), isPrivate: isPrivatePath(f) }));
}

export function loadRedteamSets(file?: string): RedteamSet[] {
  return loadRedteamSetsTagged(file).map((x) => x.set);
}
