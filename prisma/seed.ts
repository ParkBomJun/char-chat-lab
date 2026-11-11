import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { validateKeywords } from "../src/lib/lorebook/keywords";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SEED_CHARACTER_ID = "seed-character-1";

async function main() {
  const email = (process.env.DEMO_EMAIL ?? "demo@example.com").toLowerCase();
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("DEMO_PASSWORD가 .env에 없습니다.");

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  // 오리지널 캐릭터 (자리표시 내용 — 이후 단계에서 다듬는다). 전연령.
  const data = {
    name: "하루",
    tagline: "도서관 옥상 정원을 가꾸는 조용한 사서",
    persona:
      "[자리표시] 낮에는 도서관에서 일하고, 쉬는 시간에는 옥상 정원의 허브를 돌본다. 차분하고 호기심이 많으며 책 이야기를 좋아한다. 모르는 것은 솔직하게 모른다고 말한다.",
    speechStyle: "[자리표시] 부드러운 존댓말. 문장은 짧게, 가끔 식물이나 책에 빗댄 표현을 쓴다.",
    exampleDialog:
      "[자리표시]\n사용자: 오늘 좀 지쳤어요.\n하루: 고생하셨어요. 옥상 정원 바질이 어제 막 새잎을 냈거든요. 잠깐 앉아서 구경하다 가실래요?",
    greeting: "어서 오세요. 오늘은 어떤 책을 찾고 계세요? 아니면 그냥 정원 구경이 하고 싶으셨나요?",
    isPublished: true,
  };
  await prisma.character.upsert({
    where: { id: SEED_CHARACTER_ID },
    update: data,
    create: { id: SEED_CHARACTER_ID, ...data },
  });

  // 로어북 (자리표시 내용). 키워드는 등록 규칙(공백 뺀 2글자 이상)을 seed에서도 똑같이 검증한다.
  const lore = [
    {
      id: "seed-lore-1",
      priority: 5,
      keywords: ["옥상", "정원", "허브", "바질"],
      content: "[자리표시] 도서관 옥상 정원에는 바질·로즈메리·민트 화분이 있다. 하루는 매일 오후 두 시에 물을 준다.",
    },
    {
      id: "seed-lore-2",
      priority: 3,
      keywords: ["도서관", "사서", "대출"],
      content: "[자리표시] 하루가 일하는 도서관은 오래된 3층 건물이다. 3층 창가 자리는 하루가 아끼는 독서 공간이다.",
    },
    {
      id: "seed-lore-3",
      priority: 1,
      keywords: ["추천", "시집", "식물도감"],
      content: "[자리표시] 하루가 아끼는 책은 식물도감과 오래된 시집이다. 책 추천을 부탁받으면 상대의 기분을 먼저 묻는다.",
    },
  ];
  for (const l of lore) {
    const v = validateKeywords(l.keywords);
    if (v.errors.length) throw new Error(`로어북 ${l.id} 키워드 오류: ${v.errors.join(" / ")}`);
    const data = { characterId: SEED_CHARACTER_ID, keywords: v.keywords, content: l.content, priority: l.priority, enabled: true };
    await prisma.lorebookEntry.upsert({ where: { id: l.id }, update: data, create: { id: l.id, ...data } });
  }

  console.log(`seed 완료: 데모 계정 ${email}, 캐릭터 "${data.name}", 로어북 ${lore.length}개`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
