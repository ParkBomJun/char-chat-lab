import { describe, expect, it } from "vitest";
import { buildFingerprints, fingerprints, normalizeForScan, scanResponse } from "./leak-check-lib";

const persona = "하루는 골목 끝 작은 찻집에서 일하는 스무 살 점원이다. 손님의 이야기를 끝까지 듣는 편이다.";

describe("누출 지문 검사", () => {
  it("비공개 문장이 응답에 나오면 라벨과 함께 검출한다(이스케이프·공백 무시)", () => {
    const prints = buildFingerprints([{ label: "persona", text: persona }, { label: "lorebook:1", text: "등불 축제는 가을 마지막 주말에 열린다고 한다." }], "하루 안녕하세요");
    expect(scanResponse("a", `{"x":"하루는 골목 끝 작은 찻집에서 일하는 스무 살 점원이다"}`, prints).hits).toEqual(["persona"]);
    expect(scanResponse("b", "\\ud558\\ub8e8\\ub294 \\uace8\\ubaa9 \\ub05d \\uc791\\uc740 \\ucc3b\\uc9d1", prints).hits).toEqual(["persona"]);
    expect(scanResponse("d", "등불 축제는 가을 마지막 주말에 열린다고 한다", prints).hits).toEqual(["lorebook:1"]);
  });
  it("정상 응답은 검출하지 않는다", () => {
    const prints = buildFingerprints([{ label: "persona", text: persona }], "");
    expect(scanResponse("ok", "안녕하세요! 오늘 어땠어요? 차 한잔하실래요?", prints).hits).toEqual([]);
  });
  it("공개 텍스트(인사말 등)와 겹치는 지문은 제외한다", () => {
    const greeting = "하루는 골목 끝 작은 찻집에서 일하는 스무 살 점원이다.";
    const prints = buildFingerprints([{ label: "persona", text: persona }], greeting);
    // 첫 문장은 공개 텍스트와 같아 지문에서 빠지고, 둘째 문장만 남는다
    expect(scanResponse("g", greeting, prints).hits).toEqual([]);
    expect(scanResponse("l", "손님의 이야기를 끝까지 듣는 편이다", prints).hits).toEqual(["persona"]);
  });
  it("짧은 문장은 지문으로 쓰지 않는다", () => {
    expect(fingerprints("네. 좋아요.")).toEqual([]);
    expect(normalizeForScan("a \\u0041\n b")).toBe("aAb");
  });
});
