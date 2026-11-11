import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { validateKeywords } from "../src/lib/lorebook/keywords";
import haru from "./seed-data/haru.json";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SEED_CHARACTER_ID = "seed-character-1";

/**
 * SEED_PRESERVE=1(운영 배포): 이미 있는 데이터는 건드리지 않고 없는 것만 만든다.
 * 그렇지 않으면 배포할 때마다 관리자가 고친 시드 캐릭터·로어북이 초기값으로 되돌아가고 비밀번호도 덮어써진다.
 * 비밀번호를 일부러 바꾸려면 SEED_RESET_PASSWORDS=1을 함께 준다.
 */
const preserve = process.env.SEED_PRESERVE === "1";
const resetPasswords = !preserve || process.env.SEED_RESET_PASSWORDS === "1";

async function main() {
  const email = (process.env.DEMO_EMAIL ?? "demo@example.com").toLowerCase();
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("DEMO_PASSWORD가 .env에 없습니다.");

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: resetPasswords ? { passwordHash } : {},
    create: { email, passwordHash },
  });

  // 관리자 계정: ADMIN_EMAIL/ADMIN_PASSWORD가 둘 다 있을 때만 만든다. 데모 계정과 달리 role=ADMIN.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const adminHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: resetPasswords ? { passwordHash: adminHash, role: "ADMIN" } : {},
      create: { email: adminEmail, passwordHash: adminHash, role: "ADMIN" },
    });
  }

  // 오리지널 캐릭터. 내용은 prisma/seed-data/haru.json (전연령). 우선순위는 관리자 화면에서 바꿀 수 있다.
  const data = { ...haru.character, isPublished: true };
  await prisma.character.upsert({
    where: { id: SEED_CHARACTER_ID },
    update: preserve ? {} : data,
    create: { id: SEED_CHARACTER_ID, ...data },
  });

  // 로어북. 키워드는 등록 규칙(공백 뺀 2글자 이상)을 seed에서도 똑같이 검증한다.
  const lore = haru.lorebook;
  for (const l of lore) {
    const v = validateKeywords(l.keywords);
    if (v.errors.length) throw new Error(`로어북 ${l.id} 키워드 오류: ${v.errors.join(" / ")}`);
    const data = { characterId: SEED_CHARACTER_ID, keywords: v.keywords, content: l.content, priority: l.priority, enabled: true };
    await prisma.lorebookEntry.upsert({ where: { id: l.id }, update: preserve ? {} : data, create: { id: l.id, ...data } });
  }

  // 카드 개정으로 상시 세계관(persona)으로 옮겨진 로어북 항목은 지운다. 보존 모드(운영)에서는 관리자 수정을 지키려고 건드리지 않는다.
  if (!preserve && haru.removedLorebookIds.length) {
    const r = await prisma.lorebookEntry.deleteMany({ where: { characterId: SEED_CHARACTER_ID, id: { in: haru.removedLorebookIds } } });
    if (r.count) console.log(`로어북 ${r.count}개 삭제(카드 개정으로 persona에 통합: ${haru.removedLorebookIds.join(", ")})`);
  }

  console.log(`seed 완료${preserve ? "(보존 모드)" : ""}: 데모 계정 ${email}, 관리자 ${adminEmail && adminPassword ? adminEmail : "(미생성: ADMIN_EMAIL/ADMIN_PASSWORD 없음)"}, 캐릭터 "${data.name}", 로어북 ${lore.length}개`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
