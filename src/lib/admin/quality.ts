import { prisma } from "@/lib/db";
import { summarizeQuality } from "@/lib/quality/summary";

/** 한 번에 읽는 지표 행 상한. 넘으면 최근 것만 집계하고 화면에 알린다 */
export const QUALITY_ROW_CAP = 20000;

/** 응답 품질 요약(관리자 화면). 기간 시작과 캐릭터로 거른다. 집계는 평가 리포트와 같은 summarizeQuality를 쓴다. */
export async function getQuality(since: Date, characterId: string | null, minHangulRatio: number) {
  const [rows, characters] = await Promise.all([
    prisma.responseMetric.findMany({
      where: { createdAt: { gte: since }, ...(characterId ? { characterId } : {}) },
      orderBy: { createdAt: "desc" },
      take: QUALITY_ROW_CAP + 1,
      select: { hangulRatio: true, foreignScripts: true, actionPhrases: true, length: true, paragraphs: true, endsWithQuestion: true },
    }),
    prisma.character.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const capped = rows.length > QUALITY_ROW_CAP;
  return { summary: summarizeQuality(capped ? rows.slice(0, QUALITY_ROW_CAP) : rows, minHangulRatio), capped, characters };
}
