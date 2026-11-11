import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { collectText } from "@/lib/llm/collect";
import { estimateTokens } from "@/lib/tokens";
import { buildUsageRow } from "@/lib/usage";
import { runSummaryUpdate, type SummaryOutcome } from "./update";

export const SUMMARY_MAX_OUTPUT_TOKENS = 700;
const MAX_UNSUMMARIZED_LOAD = 500;

/** Prisma unique 위반(P2002) 판별 */
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * 대화 하나의 요약을 필요하면 갱신한다. 응답이 끝난 뒤(after) 호출한다.
 * 실패해도 대화에는 영향이 없고, 다음 턴에 같은 조건으로 다시 시도된다.
 */
export async function updateSummaryForConversation(conversationId: string, userId: string): Promise<SummaryOutcome> {
  const config = loadConfig();
  const { adapter, lightModel } = getLlm();
  let promptTokens = 0;

  return runSummaryUpdate(
    {
      async load() {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId, userId },
          select: { character: { select: { name: true } } },
        });
        if (!conv) return null;

        const prev = await prisma.memorySummary.findFirst({
          where: { conversationId },
          orderBy: { version: "desc" },
          select: { content: true, version: true, coversUntilMsg: true },
        });
        const cover = prev
          ? await prisma.message.findUnique({ where: { id: prev.coversUntilMsg }, select: { createdAt: true } })
          : null;

        const messages = await prisma.message.findMany({
          where: { conversationId, retracted: false, ...(cover ? { createdAt: { gt: cover.createdAt } } : {}) },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_UNSUMMARIZED_LOAD,
          select: { id: true, role: true, content: true },
        });
        return { characterName: conv.character.name, previous: prev, messages };
      },

      async summarize(messages) {
        promptTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
        const t0 = Date.now();
        const { text, usage } = await collectText(adapter, {
          model: lightModel,
          messages,
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        });
        return { text, usage, totalMs: Date.now() - t0 };
      },

      async logUsage({ usage, outputText, totalMs }) {
        const row = buildUsageRow({
          model: lightModel,
          usage,
          blockTokens: null,
          estimatedInputTokens: promptTokens,
          outputText,
          ttftMs: null,
          totalMs,
        });
        await prisma.usageLog.create({ data: { userId, conversationId, kind: "SUMMARY", ...row, blockTokens: Prisma.DbNull } });
      },

      async save(row) {
        try {
          await prisma.memorySummary.create({ data: { conversationId, ...row } });
          return true;
        } catch (e) {
          if (isUniqueViolation(e)) return false; // 동시에 다른 갱신이 같은 버전을 저장함
          throw e;
        }
      },
    },
    { recentTurns: config.recentTurns, summaryEvery: config.summaryEvery },
  );
}
