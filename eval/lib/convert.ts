/**
 * 레드팀 표 → 레드팀 세트 JSON 변환(순수 함수).
 * 입력 표 열: id, 범주, 기법, 대화('||'로 턴 구분), 기대 결과. 형식은 CSV·TSV·마크다운 표를 자동 인식한다.
 * 기대 결과: 통과 / 입력 차단 / 출력 회수 / 흐름 경고·중단 / 위기 안내.
 *   통과 → label=benign, expect=pass
 *   입력 차단 → attack, expect=block, expectAt=input
 *   출력 회수 → attack, expect=block, expectAt=output
 *   흐름 경고·중단 → attack, expect=block, expectAt=flow (흐름 감시가 경고·위반·중단 중 하나라도 하면 정답)
 *   위기 안내 → attack, expect=crisis
 */
import { redteamSetSchema, type RedteamSet } from "./schema";

export type Row = { line: number; cells: Record<string, string> };

const HEADER_KEYS: Record<string, string> = {
  id: "id",
  범주: "category",
  카테고리: "category",
  category: "category",
  기법: "technique",
  technique: "technique",
  대화: "turns",
  turns: "turns",
  conversation: "turns",
  기대결과: "expect",
  기대: "expect",
  expect: "expect",
  expected: "expect",
};

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 간단한 CSV/TSV 파서(따옴표 안의 구분자·줄바꿈·이중 따옴표 지원). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const push = () => {
    row.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    push();
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 마크다운 표의 한 줄을 셀로 나눈다. 대화 칸의 '||'(연속 파이프)는 구분자가 아니라 내용으로 둔다. */
export function splitMarkdownRow(line: string): string[] {
  const t = line.trim().replace(/^\|(?!\|)/, "").replace(/(?<!\|)\|$/, "");
  return t.split(/(?<!\|)\|(?!\|)/).map((c) => c.trim());
}

export type Format = "csv" | "tsv" | "md";
export function detectFormat(text: string, fileName = ""): Format {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "tsv") return "tsv";
  if (ext === "csv") return "csv";
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (first.trim().startsWith("|")) return "md";
  return first.includes("\t") ? "tsv" : "csv";
}

export function parseTable(text: string, format: Format): string[][] {
  const clean = text.replace(/^﻿/, "");
  if (format === "md") {
    return clean
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("|"))
      .map(splitMarkdownRow)
      .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, ""))));
  }
  return parseDelimited(clean, format === "tsv" ? "\t" : ",");
}

export type ConvertResult = { set: RedteamSet; warnings: string[] };

const EXPECT_MAP: Record<string, { label: "attack" | "benign"; expect: "pass" | "block" | "crisis"; expectAt?: "input" | "output" | "flow" }> = {
  통과: { label: "benign", expect: "pass" },
  입력차단: { label: "attack", expect: "block", expectAt: "input" },
  출력회수: { label: "attack", expect: "block", expectAt: "output" },
  흐름경고중단: { label: "attack", expect: "block", expectAt: "flow" },
  위기안내: { label: "attack", expect: "crisis" },
};
export const EXPECT_VALUES = ["통과", "입력 차단", "출력 회수", "흐름 경고·중단", "위기 안내"];

/** 표 기대 결과 값 → 케이스 필드. 공백·구분 기호(·,/)는 무시한다. */
export function mapExpect(raw: string) {
  return EXPECT_MAP[raw.replace(/[\s·ㆍ,/、]/g, "")] ?? null;
}

/** 표(행 배열, 첫 행이 머리글) → 세트. 오류는 줄 번호와 함께 한꺼번에 던진다. */
export function tableToSet(table: string[][], meta: { id: string; description?: string }): ConvertResult {
  if (table.length < 2) throw new Error("표에 머리글과 데이터 행이 필요합니다.");
  const cols = new Map<string, number>();
  table[0].forEach((h, i) => {
    const key = HEADER_KEYS[norm(h)];
    if (key && !cols.has(key)) cols.set(key, i);
  });
  const missing = ["id", "category", "turns", "expect"].filter((k) => !cols.has(k));
  if (missing.length) {
    const ko: Record<string, string> = { id: "id", category: "범주", turns: "대화", expect: "기대 결과" };
    throw new Error(`머리글에 필요한 열이 없습니다: ${missing.map((k) => ko[k]).join(", ")} (읽은 머리글: ${table[0].join(" / ")})`);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const cases: unknown[] = [];
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const get = (k: string) => (cols.has(k) ? (table[r][cols.get(k)!] ?? "").trim() : "");
    const id = get("id");
    if (!id) {
      errors.push(`${line}행: id가 비어 있습니다.`);
      continue;
    }
    if (seen.has(id)) errors.push(`${line}행: id "${id}"가 중복됩니다.`);
    seen.add(id);
    const m = mapExpect(get("expect"));
    if (!m) errors.push(`${line}행(${id}): 기대 결과 "${get("expect")}"를 알 수 없습니다. 가능한 값: ${EXPECT_VALUES.join(" / ")}`);
    const rawTurns = get("turns").split("||").map((t) => t.trim());
    const turns = rawTurns.filter(Boolean);
    if (turns.length === 0) errors.push(`${line}행(${id}): 대화가 비어 있습니다.`);
    else if (turns.length !== rawTurns.length) warnings.push(`${line}행(${id}): 비어 있는 턴 ${rawTurns.length - turns.length}개를 건너뛰었습니다('||' 앞뒤 확인).`);
    if (!m || turns.length === 0) continue;
    cases.push({
      id,
      label: m.label,
      category: get("category") || "unspecified",
      ...(get("technique") ? { technique: get("technique") } : {}),
      turns,
      expect: m.expect,
      ...(m.expectAt ? { expectAt: m.expectAt } : {}),
    });
  }
  if (errors.length) throw new Error(`변환 실패(${errors.length}건):\n  ${errors.join("\n  ")}`);
  const parsed = redteamSetSchema.safeParse({ id: meta.id, description: meta.description ?? "", cases });
  if (!parsed.success) throw new Error(`세트 형식 오류:\n  ${parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n  ")}`);
  return { set: parsed.data, warnings };
}
