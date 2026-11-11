import { prisma } from "@/lib/db";
import { computeResponseQuality } from "./metrics";

/**
 * ASSISTANT 응답의 품질 지표를 저장한다(메시지당 1행, 다시 계산하면 덮어쓴다).
 * 회수된 메시지는 호출 측이 넘기지 않는다. createdAt은 메시지 시각을 그대로 써서 기간 필터가 메시지 기준이 되게 한다.
 */
export async function saveResponseMetric(m: { messageId: string; conversationId: string; characterId: string; content: string; createdAt?: Date }) {
  const q = computeResponseQuality(m.content);
  const data = {
    conversationId: m.conversationId,
    characterId: m.characterId,
    hangulRatio: q.hangulRatio,
    hasForeignScript: q.foreignScripts.length > 0,
    foreignScripts: q.foreignScripts,
    actionPhrases: q.actionPhrases,
    length: q.length,
    paragraphs: q.paragraphs,
    endsWithQuestion: q.endsWithQuestion,
    ...(m.createdAt ? { createdAt: m.createdAt } : {}),
  };
  await prisma.responseMetric.upsert({ where: { messageId: m.messageId }, update: data, create: { messageId: m.messageId, ...data } });
}
