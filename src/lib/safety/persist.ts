import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildUsageRow } from "@/lib/usage";
import type { ClassifyCall } from "./classifier";
import { evaluateFlow, type FlowConfig, type FlowResult, type FlowStatus } from "./flow";
import { NOTICE } from "./messages";
import type { ModEvent } from "./types";

/** 판정 기록. 입력·출력·흐름 모두, 통과 점수까지 남긴다(오탐 분석용). */
export async function saveEvents(conversationId: string, messageId: string | null, events: readonly ModEvent[]) {
  if (events.length === 0) return;
  await prisma.moderationEvent.createMany({
    data: events.map((e) => ({ conversationId, messageId, ...e })),
  });
}

/** 분류기 호출 비용도 UsageLog에 남긴다(SPEC 3-6). 기록 실패가 대화를 깨지 않게 삼킨다. */
export async function logClassifierCalls(userId: string, conversationId: string, calls: readonly ClassifyCall[]) {
  for (const c of calls) {
    try {
      const row = buildUsageRow({
        model: c.model,
        usage: c.usage,
        blockTokens: null,
        estimatedInputTokens: c.promptTokens,
        outputText: c.outputText,
        ttftMs: null,
        totalMs: c.totalMs,
      });
      await prisma.usageLog.create({ data: { userId, conversationId, kind: "CLASSIFIER", ...row, blockTokens: Prisma.DbNull } });
    } catch (e) {
      console.error("[safety] 분류기 UsageLog 기록 실패", e);
    }
  }
}

export async function saveNotice(conversationId: string, text: string): Promise<string> {
  const m = await prisma.message.create({
    data: { conversationId, role: "SYSTEM_NOTICE", content: text },
    select: { id: true },
  });
  return m.id;
}

export type FlowOutcome = { result: FlowResult; notice: { kind: "warned" | "stopped"; text: string; id: string } | null };

/**
 * 대화 흐름 감시 적용 (SPEC 3-5-3). 이번 턴 점수를 기록하고, 마지막 경고/위반 이후의 점수로 평가해
 * Conversation.status/riskScore를 갱신하고 필요하면 안내 메시지를 남긴다.
 */
export async function applyFlow(conversationId: string, turnScore: number, cfg: FlowConfig): Promise<FlowOutcome> {
  await prisma.moderationEvent.create({
    data: { conversationId, stage: "CONVERSATION", layer: "RULE", verdict: "ALLOW", category: "turn", score: turnScore, action: "none" },
  });

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { status: true } });
  if (!conv) throw new Error("대화를 찾을 수 없음");

  const lastFlow = await prisma.moderationEvent.findFirst({
    where: { conversationId, stage: "CONVERSATION", action: { in: ["warned", "strike", "stopped"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const turns = await prisma.moderationEvent.findMany({
    where: { conversationId, stage: "CONVERSATION", category: "turn", ...(lastFlow ? { createdAt: { gt: lastFlow.createdAt } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { score: true },
  });
  const strikes = await prisma.moderationEvent.count({ where: { conversationId, stage: "CONVERSATION", action: "strike" } });

  const result = evaluateFlow(
    turns.map((t) => t.score ?? 0),
    { status: conv.status as FlowStatus, strikes },
    cfg,
  );

  await prisma.conversation.update({ where: { id: conversationId }, data: { status: result.status, riskScore: result.avg } });

  if (result.action === "none") return { result, notice: null };

  await prisma.moderationEvent.create({
    data: { conversationId, stage: "CONVERSATION", layer: "RULE", verdict: "BLOCK", category: "flow", score: result.avg, action: result.action },
  });
  const kind = result.action === "stopped" ? "stopped" : "warned";
  const text = kind === "stopped" ? NOTICE.stopped : NOTICE.warned;
  const id = await saveNotice(conversationId, text);
  return { result, notice: { kind, text, id } };
}
