-- AlterTable
ALTER TABLE "UsageLog" ADD COLUMN     "blockTokens" JSONB,
ADD COLUMN     "usageEstimated" BOOLEAN NOT NULL DEFAULT false;
