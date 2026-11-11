-- AlterTable
ALTER TABLE "ModerationEvent" ADD COLUMN "hasCodeFence" BOOLEAN,
ADD COLUMN "hasRefusalPattern" BOOLEAN,
ADD COLUMN "responseLength" INTEGER,
ADD COLUMN "startsWithBrace" BOOLEAN;
