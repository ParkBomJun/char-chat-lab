import { describe, expect, it } from "vitest";
import { parseCharacterForm, parseLoreForm } from "./forms";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const card = { name: "하루", tagline: "소개", persona: "성격", speechStyle: "말투", exampleDialog: "예시", greeting: "안녕" };

describe("parseCharacterForm", () => {
  it("정상 입력, 체크박스는 on일 때만 true", () => {
    expect(parseCharacterForm(fd({ ...card, isPublished: "on" }))).toEqual({ ok: true, data: { ...card, imageUrl: null, avatarUrl: null, isPublished: true } });
    expect(parseCharacterForm(fd(card))).toMatchObject({ ok: true, data: { isPublished: false } });
  });
  it("그림 경로는 /characters/ 아래의 내부 경로만 받는다(비우면 null)", () => {
    const ok = parseCharacterForm(fd({ ...card, imageUrl: " /characters/haru/cover.webp ", avatarUrl: "/characters/haru/avatar.webp" }));
    expect(ok).toMatchObject({ ok: true, data: { imageUrl: "/characters/haru/cover.webp", avatarUrl: "/characters/haru/avatar.webp" } });
    for (const bad of [
      "https://example.com/a.webp", // 외부 주소
      "//example.com/a.webp",
      "/characters/../secret.webp", // 상위 경로
      "/images/haru/cover.webp", // 다른 폴더
      "/characters/haru/cover.webp?x=1", // 쿼리
      "/characters/haru/cover.svg", // 허용하지 않는 형식
      "characters/haru/cover.webp",
      "javascript:alert(1)",
    ]) {
      expect(parseCharacterForm(fd({ ...card, imageUrl: bad })), bad).toMatchObject({ ok: false });
      expect(parseCharacterForm(fd({ ...card, avatarUrl: bad })), bad).toMatchObject({ ok: false });
    }
  });
  it("앞뒤 공백은 제거하고, 빈 값·초과 길이는 항목 이름이 든 오류", () => {
    expect(parseCharacterForm(fd({ ...card, name: "  하루  " }))).toMatchObject({ data: { name: "하루" } });
    expect(parseCharacterForm(fd({ ...card, name: "   " }))).toEqual({ ok: false, error: "이름을(를) 입력해 주세요." });
    const r = parseCharacterForm(fd({ ...card, tagline: "가".repeat(101) }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("한 줄 소개");
  });
});

describe("parseLoreForm", () => {
  const base = { keywords: "옥상, 정원\n허브", content: "내용", priority: "5" };
  it("키워드를 줄바꿈·쉼표로 나누고 정규화", () => {
    expect(parseLoreForm(fd({ ...base, enabled: "on" }))).toEqual({
      ok: true,
      data: { keywords: ["옥상", "정원", "허브"], content: "내용", priority: 5, enabled: true },
    });
  });
  it("1글자 키워드는 거절(5단계 매칭과 같은 규칙)", () => {
    const r = parseLoreForm(fd({ ...base, keywords: "옥상, 책" }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("책");
  });
  it("우선순위: 빈 값은 0, 정수가 아니거나 범위 밖이면 거절", () => {
    expect(parseLoreForm(fd({ ...base, priority: "" }))).toMatchObject({ data: { priority: 0 } });
    expect(parseLoreForm(fd({ ...base, priority: "1.5" }))).toMatchObject({ ok: false });
    expect(parseLoreForm(fd({ ...base, priority: "abc" }))).toMatchObject({ ok: false });
    expect(parseLoreForm(fd({ ...base, priority: "101" }))).toMatchObject({ ok: false });
  });
  it("내용이 비었거나 1000자 초과면 거절, 체크박스 미체크는 비활성", () => {
    expect(parseLoreForm(fd({ ...base, content: " " }))).toMatchObject({ ok: false });
    expect(parseLoreForm(fd({ ...base, content: "가".repeat(1001) }))).toMatchObject({ ok: false });
    expect(parseLoreForm(fd(base))).toMatchObject({ data: { enabled: false } });
  });
});
