-- AlterTable: 캐릭터 그림 경로(표지·아바타). 사이트 내부 경로(/characters/…)만 저장한다. 없으면 NULL(글자 표지)
ALTER TABLE "Character" ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "avatarUrl" TEXT;
