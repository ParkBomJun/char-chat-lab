-- CreateTable
CREATE TABLE "ResponseMetric" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "hangulRatio" DOUBLE PRECISION,
    "hasForeignScript" BOOLEAN NOT NULL DEFAULT false,
    "foreignScripts" TEXT[],
    "actionPhrases" TEXT[],
    "length" INTEGER NOT NULL,
    "paragraphs" INTEGER NOT NULL,
    "endsWithQuestion" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponseMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResponseMetric_messageId_key" ON "ResponseMetric"("messageId");

-- CreateIndex
CREATE INDEX "ResponseMetric_createdAt_idx" ON "ResponseMetric"("createdAt");

-- CreateIndex
CREATE INDEX "ResponseMetric_characterId_createdAt_idx" ON "ResponseMetric"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "ResponseMetric" ADD CONSTRAINT "ResponseMetric_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
