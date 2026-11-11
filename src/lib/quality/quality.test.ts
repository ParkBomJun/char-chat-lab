import { describe, expect, it } from "vitest";
import { computeResponseQuality as q } from "./metrics";
import { summarizeQuality } from "./summary";
import { pickMetricTargets } from "./backfill";
import { loadConfig } from "@/lib/config";

describe("computeResponseQuality", () => {
  it("hangulRatio: 공백·문장부호·숫자·이모지를 뺀 글자 중 한글 비율", () => {
    expect(q("안녕하세요! 123 😀").hangulRatio).toBe(1);
    expect(q("안녕 hi").hangulRatio).toBeCloseTo(2 / 4);
    expect(q("hello").hangulRatio).toBe(0);
    expect(q("ㅋㅋㅋ 좋아").hangulRatio).toBe(1); // 낱자모도 한글
  });
  it("글자가 하나도 없으면 hangulRatio는 null", () => {
    expect(q("123 ... !?").hangulRatio).toBeNull();
    expect(q("").hangulRatio).toBeNull();
  });
  it("foreignScripts: 한글·라틴 외 문자의 종류. 영어만 섞인 것은 해당 없음", () => {
    expect(q("오늘은 good day").foreignScripts).toEqual([]);
    expect(q("오늘은 天気가 좋아").foreignScripts).toEqual(["han"]);
    expect(q("ありがとう 고마워 カタカナ").foreignScripts).toEqual(["kana"]);
    expect(q("привет 안녕 你好").foreignScripts).toEqual(["cyrillic", "han"]);
    expect(q("สวัสดี 안녕 مرحبا").foreignScripts).toEqual(["arabic", "thai"]);
    expect(q("안녕 ქართული").foreignScripts).toEqual(["other"]);
  });
  it("actionPhrases: 괄호 안 문구를 앞뒤 공백을 지워 순서대로(중복 포함), 전각 괄호도", () => {
    expect(q("( 고개를 끄덕이며 ) 그래요. (웃음) 그리고 （손을 흔든다） (웃음)").actionPhrases).toEqual(["고개를 끄덕이며", "웃음", "손을 흔든다", "웃음"]);
  });
  it("빈 괄호·줄을 넘는 괄호는 문구가 아니다", () => {
    expect(q("() (   ) (여러 줄\n걸친 것)").actionPhrases).toEqual([]);
  });
  it("길이는 글자 수(이모지도 1자), 문단은 줄바꿈으로 나뉜 비어 있지 않은 덩어리", () => {
    expect(q("가나다 😀").length).toBe(5);
    expect(q("첫 문단\n\n둘째 문단\n셋째\n\n\n  \n넷째").paragraphs).toBe(4);
    expect(q("한 줄").paragraphs).toBe(1);
    expect(q("").paragraphs).toBe(0);
  });
  it("endsWithQuestion: 물음표 뒤의 따옴표·괄호·공백·이모지는 무시", () => {
    expect(q("어떻게 생각해요?").endsWithQuestion).toBe(true);
    expect(q("\"정말요？\" ").endsWithQuestion).toBe(true);
    expect(q("뭐 하고 싶어? 😊").endsWithQuestion).toBe(true);
    expect(q("(궁금한 듯) 그럴까?)").endsWithQuestion).toBe(true);
    expect(q("질문이 있어요? 아니요.").endsWithQuestion).toBe(false);
    expect(q("").endsWithQuestion).toBe(false);
  });
});

describe("summarizeQuality", () => {
  const rows = [
    q("(웃음) 안녕하세요. 오늘 뭐 했어요?"),
    q("(웃음) (웃음) 좋아요\n1\n2\n3\n4"), // 문단 5개, 같은 문구 두 번은 한 번으로 센다
    q("(고개를 끄덕이며) This is mostly English text here"),
    q("天気가 좋네요"),
  ];
  const s = summarizeQuality(rows, 0.9);
  it("외국어 섞임 = 한글 비율이 기준 미만인 응답", () => {
    expect(s.n).toBe(4);
    expect(s.belowHangul).toEqual({ k: 2, rate: 0.5 }); // 영어 위주 응답, 한자 섞인 응답
    expect(summarizeQuality(rows, 0.5).belowHangul.k).toBe(1); // 기준을 낮추면 줄어든다
  });
  it("한글·라틴 외 문자 섞임과 종류별 응답 수", () => {
    expect(s.foreign).toEqual({ k: 1, rate: 0.25, byScript: { han: 1 } });
  });
  it("행동 묘사 상위: 문구가 나온 응답 수와 비율(응답 안 중복은 1번), 많은 순", () => {
    expect(s.topActions).toEqual([
      { phrase: "웃음", count: 2, rate: 0.5 },
      { phrase: "고개를 끄덕이며", count: 1, rate: 0.25 },
    ]);
    expect(s.withAction).toEqual({ k: 3, rate: 0.75 });
  });
  it("상위 5개까지만", () => {
    const many = summarizeQuality(["a", "b", "c", "d", "e", "f", "g"].map((x) => q(`(${x}${x})`)), 0.9);
    expect(many.topActions).toHaveLength(5);
  });
  it("평균 길이, 문단 4개 초과 비율, 질문으로 끝나는 비율", () => {
    expect(s.avgLength).toBeCloseTo(rows.reduce((a, r) => a + r.length, 0) / 4);
    expect(s.manyParagraphs).toEqual({ k: 1, rate: 0.25 });
    expect(s.endsWithQuestion).toEqual({ k: 1, rate: 0.25 });
    expect(summarizeQuality([q("1\n2\n3\n4")], 0.9).manyParagraphs.k).toBe(0); // 정확히 4개는 '초과'가 아니다
  });
  it("글자가 없는 응답은 외국어 섞임으로 세지 않고, 응답이 없으면 비율은 null", () => {
    expect(summarizeQuality([q("...")], 0.9).belowHangul.k).toBe(0);
    const empty = summarizeQuality([], 0.9);
    expect(empty).toMatchObject({ n: 0, avgLength: null, topActions: [] });
    expect(empty.belowHangul.rate).toBeNull();
  });
});

describe("pickMetricTargets", () => {
  const m = (id: string, role: "USER" | "ASSISTANT" | "SYSTEM_NOTICE", retracted = false) => ({ id, role, retracted });
  it("첫 인사·회수된 응답·안내 메시지를 빼고 모델 응답만 고른다", () => {
    const picked = pickMetricTargets([m("greet", "ASSISTANT"), m("u1", "USER"), m("a1", "ASSISTANT"), m("u2", "USER"), m("a2", "ASSISTANT", true), m("n", "SYSTEM_NOTICE"), m("u3", "USER"), m("a3", "ASSISTANT")]);
    expect(picked.map((x) => x.id)).toEqual(["a1", "a3"]);
  });
  it("사용자 메시지가 없는 대화는 대상이 없다", () => {
    expect(pickMetricTargets([m("greet", "ASSISTANT")])).toEqual([]);
  });
});

describe("QUALITY_MIN_HANGUL_RATIO", () => {
  it("기본 0.9, 환경변수로 바꿀 수 있고 빈 값은 기본값", () => {
    expect(loadConfig({}).quality.minHangulRatio).toBe(0.9);
    expect(loadConfig({ QUALITY_MIN_HANGUL_RATIO: "0.7" }).quality.minHangulRatio).toBe(0.7);
    expect(loadConfig({ QUALITY_MIN_HANGUL_RATIO: "" }).quality.minHangulRatio).toBe(0.9);
  });
});
