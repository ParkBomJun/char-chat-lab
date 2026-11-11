import { describe, expect, it } from "vitest";
import { lastTurns, matchLorebook, type LorebookEntryData, type ScanMessage } from "./match";
import { normalizeForMatch, validateKeywords } from "./keywords";

const E = (id: string, keywords: string[], priority = 0, enabled = true): LorebookEntryData => ({
  id,
  keywords,
  content: `내용-${id}`,
  priority,
  enabled,
});
const U = (content: string): ScanMessage => ({ role: "USER", content });
const A = (content: string): ScanMessage => ({ role: "ASSISTANT", content });

describe("matchLorebook", () => {
  it("키워드가 나오면 해당 항목이 걸린다", () => {
    const hits = matchLorebook([E("a", ["옥상"]), E("b", ["지하실"])], [U("옥상에 가고 싶어요")], 4);
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("조사가 붙어도(부분 문자열), 공백·대소문자는 무시", () => {
    expect(matchLorebook([E("a", ["옥상정원"])], [U("옥상 정원에서요")], 4)).toHaveLength(1);
    expect(matchLorebook([E("a", ["Library"])], [U("the LIBRARY is closed")], 4)).toHaveLength(1);
    expect(matchLorebook([E("a", ["바질"])], [U("바질이랑 로즈메리는요?")], 4)).toHaveLength(1);
  });

  it("캐릭터 메시지에서 나온 키워드도 걸린다", () => {
    expect(matchLorebook([E("a", ["허브"])], [U("안녕"), A("허브차 드실래요?")], 4)).toHaveLength(1);
  });

  it("1글자 키워드는 무시(오탐 방지)", () => {
    expect(matchLorebook([E("a", ["책"])], [U("책 읽는 중")], 4)).toEqual([]);
  });

  it("비활성 항목은 안 걸린다", () => {
    expect(matchLorebook([E("a", ["옥상"], 0, false)], [U("옥상")], 4)).toEqual([]);
  });

  it("키워드가 여러 개여도 항목은 한 번만", () => {
    expect(matchLorebook([E("a", ["옥상", "정원"])], [U("옥상 정원")], 4)).toHaveLength(1);
  });

  it("최근 M턴 밖의 키워드는 안 걸린다", () => {
    const msgs = [U("옥상 이야기"), A("네"), U("2턴"), A("a"), U("3턴"), A("b"), U("4턴"), A("c"), U("5턴")];
    expect(matchLorebook([E("a", ["옥상"])], msgs, 4)).toEqual([]); // 1턴은 창 밖
    expect(matchLorebook([E("a", ["옥상"])], msgs, 5)).toHaveLength(1);
  });

  it("결과는 우선순위 높은 순, 같으면 id 순 — 입력 순서와 무관", () => {
    const entries = [E("c", ["옥상"], 1), E("a", ["옥상"], 1), E("b", ["옥상"], 9)];
    const r1 = matchLorebook(entries, [U("옥상")], 4).map((h) => h.id);
    const r2 = matchLorebook([...entries].reverse(), [U("옥상")], 4).map((h) => h.id);
    expect(r1).toEqual(["b", "a", "c"]);
    expect(r2).toEqual(r1);
  });

  it("빈 대화·빈 키워드 목록은 안전", () => {
    expect(matchLorebook([E("a", ["옥상"])], [], 4)).toEqual([]);
    expect(matchLorebook([E("a", [])], [U("옥상")], 4)).toEqual([]);
  });
});

describe("lastTurns", () => {
  it("SYSTEM_NOTICE 제외, 턴 수 모자라면 전부", () => {
    const m: ScanMessage[] = [A("인사"), U("1"), { role: "SYSTEM_NOTICE", content: "안내" }, A("a")];
    expect(lastTurns(m, 4).map((x) => x.content)).toEqual(["인사", "1", "a"]);
  });
  it("정확히 M개의 USER 메시지부터 자른다", () => {
    const m = [U("1"), A("a"), U("2"), A("b"), U("3")];
    expect(lastTurns(m, 2).map((x) => x.content)).toEqual(["2", "b", "3"]);
  });
});

describe("validateKeywords", () => {
  it("공백 제거 후 2글자 미만, 중복, 빈 값 처리", () => {
    const r = validateKeywords(["옥상", " 옥 상 ", "책", "", "Library", "library"]);
    expect(r.keywords).toEqual(["옥상", "Library"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("책");
  });
  it("전부 비어 있으면 오류", () => {
    expect(validateKeywords(["", "  "]).errors).toEqual(["키워드가 하나 이상 필요합니다."]);
  });
  it("너무 긴 키워드와 개수 초과", () => {
    expect(validateKeywords(["가".repeat(41)]).errors[0]).toContain("40자");
    const many = Array.from({ length: 25 }, (_, i) => `키워드${i}`);
    const r = validateKeywords(many);
    expect(r.keywords).toHaveLength(20);
    expect(r.errors.some((e) => e.includes("최대 20개"))).toBe(true);
  });
  it("normalizeForMatch는 NFC 정규화(자모 분리 입력 대응)", () => {
    const decomposed = "\u1100\u1161"; // 자모 분리된 "가"
    const composed = "\uAC00";
    expect(decomposed).not.toBe(composed);
    expect(normalizeForMatch(decomposed)).toBe(normalizeForMatch(composed));
  });
});
