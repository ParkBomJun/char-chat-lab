-- AlterTable
ALTER TABLE "ModerationEvent" ADD COLUMN "errorKind" TEXT,
ADD COLUMN "finishReason" TEXT,
ADD COLUMN "httpStatus" INTEGER;
