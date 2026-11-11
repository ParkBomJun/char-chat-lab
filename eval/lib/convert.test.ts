import { describe, expect, it } from "vitest";
import { detectFormat, mapExpect, parseTable, splitMarkdownRow, tableToSet } from "./convert";

const H = ["id", "범주", "기법", "대화", "기대 결과"];

describe("기대 결과 매핑", () => {
  it("다섯 값을 기존 형식(label/expect/expectAt)으로 바꾼다", () => {
    expect(mapExpect("통과")).toEqual({ label: "benign", expect: "pass" });
    expect(mapExpect("입력 차단")).toEqual({ label: "attack", expect: "block", expectAt: "input" });
    expect(mapExpect("출력 회수")).toEqual({ label: "attack", expect: "block", expectAt: "output" });
    expect(mapExpect("흐름 경고·중단")).toEqual({ label: "attack", expect: "block", expectAt: "flow" });
    expect(mapExpect("위기 안내")).toEqual({ label: "attack", expect: "crisis" });
  });
  it("공백·구분 기호 표기 차이를 허용하고 모르는 값은 null", () => {
    expect(mapExpect("흐름 경고/중단")).toEqual(mapExpect("흐름경고, 중단"));
    expect(mapExpect(" 입력차단 ")?.expectAt).toBe("input");
    expect(mapExpect("차단")).toBeNull();
  });
});

describe("표 파싱", () => {
  it("CSV: 따옴표 안의 쉼표·줄바꿈·이중 따옴표, '||'는 턴 구분", () => {
    const csv = 'id,범주,기법,대화,기대 결과\na-1,c1,t1,"첫째, 턴 || ""둘째"" 턴",입력 차단\nb-1,c2,,그냥 || 대화,통과\n';
    const { set } = tableToSet(parseTable(csv, detectFormat(csv, "x.csv")), { id: "s" });
    expect(set.cases[0]).toMatchObject({ id: "a-1", label: "attack", category: "c1", technique: "t1", turns: ["첫째, 턴", '"둘째" 턴'], expect: "block", expectAt: "input" });
    expect(set.cases[1]).toMatchObject({ id: "b-1", label: "benign", expect: "pass", turns: ["그냥", "대화"] });
    expect(set.cases[1]).not.toHaveProperty("technique");
  });
  it("TSV와 마크다운 표(대화 칸의 '||' 보존, 구분선 행 무시)", () => {
    const tsv = ["id\t범주\t기법\t대화\t기대 결과", "a\tc\tt\t하나 || 둘\t출력 회수"].join("\n");
    expect(tableToSet(parseTable(tsv, detectFormat(tsv, "x.tsv")), { id: "s" }).set.cases[0].turns).toEqual(["하나", "둘"]);
    const md = ["| id | 범주 | 기법 | 대화 | 기대 결과 |", "|---|---|---|---|---|", "| a | c | t | 하나 || 둘 || 셋 | 위기 안내 |"].join("\n");
    expect(detectFormat(md, "x.md")).toBe("md");
    const c = tableToSet(parseTable(md, "md"), { id: "s" }).set.cases[0];
    expect(c.turns).toEqual(["하나", "둘", "셋"]);
    expect(c).toMatchObject({ expect: "crisis", label: "attack" });
    expect(splitMarkdownRow("| a || b | c |")).toEqual(["a || b", "c"]);
  });
  it("머리글 순서·별칭이 달라도 열 이름으로 찾는다, BOM 제거", () => {
    const csv = "﻿기대결과,카테고리,turns,ID\n통과,일상,안녕,x-1\n";
    const { set } = tableToSet(parseTable(csv, "csv"), { id: "s" });
    expect(set.cases[0]).toMatchObject({ id: "x-1", category: "일상", turns: ["안녕"], expect: "pass" });
  });
});

describe("오류 보고", () => {
  it("줄 번호와 함께 한꺼번에: 중복 id·모르는 기대 결과·빈 대화", () => {
    const rows = [H, ["a", "c", "t", "x", "입력 차단"], ["a", "c", "t", "y", "차단"], ["b", "c", "t", " || ", "통과"]];
    expect(() => tableToSet(rows, { id: "s" })).toThrow(/3행: id "a"가 중복[\s\S]*3행\(a\): 기대 결과 "차단"를 알 수 없습니다[\s\S]*4행\(b\): 대화가 비어/);
  });
  it("필요한 열이 없으면 그 열 이름을 알려 준다", () => {
    expect(() => tableToSet([["id", "범주", "대화"], ["a", "c", "x"]], { id: "s" })).toThrow(/기대 결과/);
  });
  it("비어 있는 턴은 건너뛰고 경고한다", () => {
    const { set, warnings } = tableToSet([H, ["a", "c", "t", "하나 || || 둘", "입력 차단"]], { id: "s" });
    expect(set.cases[0].turns).toEqual(["하나", "둘"]);
    expect(warnings[0]).toMatch(/비어 있는 턴 1개/);
  });
});
