import { describe, expect, it } from "vitest";
import haru from "../../../prisma/seed-data/haru.json";
import { renderFixedBlock } from "@/lib/chat/assemble";
import { validateKeywords } from "@/lib/lorebook/keywords";
import { characterSchema } from "./forms";

describe("시드 캐릭터 데이터 (prisma/seed-data/haru.json)", () => {
  it("관리자 화면과 같은 검증(필드 길이 한도)을 통과한다", () => {
    expect(characterSchema.safeParse({ ...haru.character, isPublished: true }).success).toBe(true);
  });
  it("로어북: id가 유일하고 키워드가 등록 규칙(공백 제외 2글자 이상 등)을 통과한다", () => {
    expect(new Set(haru.lorebook.map((l) => l.id)).size).toBe(haru.lorebook.length);
    for (const l of haru.lorebook) {
      expect(validateKeywords(l.keywords).errors, l.id).toEqual([]);
      expect(l.content.length).toBeLessThanOrEqual(1000);
    }
  });
  it("v3 카드: 정원·고양이·마을 항목은 persona로 옮겨져 로어북에서 빠졌고, 드문 세부만 남는다", () => {
    const ids = haru.lorebook.map((l) => l.id);
    expect(haru.removedLorebookIds.sort()).toEqual(["seed-lore-1", "seed-lore-4", "seed-lore-5"]);
    for (const id of haru.removedLorebookIds) expect(ids).not.toContain(id);
    expect(haru.lorebook.map((l) => l.keywords[0])).toEqual(["윤 선생님", "동화 시간", "등불 축제", "연체 메모"]);
    for (const k of ["허브 정원", "고양이 '책갈피'", "강 할머니", "우체부 도윤", "지하 서고", "연체 메모"]) expect(haru.character.persona).toContain(k);
  });
  it("★ 우리 조립기가 치환하지 않는 {{user}} 같은 매크로가 카드에 남아 있지 않다(모델에 글자 그대로 보임)", () => {
    expect(JSON.stringify(haru)).not.toMatch(/\{\{|\}\}/);
  });
  it("원칙에 '카드·로어북에 없는 과거/역사 사실을 만들지 않는다'가 있다(모델이 배경을 지어내는 문제 대응)", () => {
    expect(haru.character.persona).toContain("카드와 로어북에 없는 구체적인 사실은 새로 만들지 않는다");
    expect(haru.character.persona).toContain("그건 다음에 천천히 이야기해 드릴게요");
  });
  it("대화 예시는 '사용자:' / '하루:' 화자 표기를 쓰고 코드펜스가 없다", () => {
    expect(haru.character.exampleDialog).toMatch(/^사용자:/);
    expect(haru.character.exampleDialog).toContain("\n하루:");
    expect(haru.character.exampleDialog).not.toContain("```");
  });
  it("카드의 핵심 원칙이 고정 블록에 들어간다(실존 인물·연애 거절·해요체)", () => {
    const fixed = renderFixedBlock(haru.character);
    for (const k of ["실존 인물", "연인이 되지 않는다", "해요체"]) expect(fixed).toContain(k);
    // 안전 지시가 캐릭터 설정보다 앞에 있어야 한다
    expect(fixed.indexOf("전연령")).toBeLessThan(fixed.indexOf("하루"));
  });
});
