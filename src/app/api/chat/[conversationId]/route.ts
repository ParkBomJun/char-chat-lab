import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getLlm } from "@/lib/llm";
import { LlmError } from "@/lib/llm/types";
import { buildSimpleMessages } from "@/lib/chat/simple-prompt";
import { formatSse } from "@/lib/sse";

export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 2000;
const bodySchema = z.object({ content: z.string().trim().min(1).max(MAX_INPUT_CHARS) });

const json = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: NextRequest, ctx: RouteContext<"/api/chat/[conversationId]">) {
  const session = await auth();
  if (!session?.user) return json(401, "로그인이 필요합니다.");

  const { conversationId } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, `메시지는 1~${MAX_INPUT_CHARS}자여야 합니다.`);

  // 소유권 확인: 남의 대화는 존재 자체를 숨긴다(404).
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    include: { character: true },
  });
  if (!conv) return json(404, "대화를 찾을 수 없습니다.");
  if (conv.status === "STOPPED") return json(409, "중단된 대화입니다.");

  await prisma.message.create({
    data: { conversationId: conv.id, role: "USER", content: parsed.data.content },
  });

  // 2단계: 단순히 최근 40개. 토큰 예산·요약은 3~4단계에서.
  const history = (
    await prisma.message.findMany({
      where: { conversationId: conv.id, retracted: false },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { role: true, content: true },
    })
  ).reverse();

  const { adapter, chatModel } = getLlm();
  const messages = buildSimpleMessages(conv.character, history);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(formatSse(event, payload)));
        } catch {
          /* 클라이언트가 이미 끊김 */
        }
      };

      let text = "";
      let failed = false;
      try {
        for await (const ev of adapter.stream({ model: chatModel, messages, signal: req.signal })) {
          if (ev.type === "delta") {
            text += ev.text;
            send("delta", { text: ev.text });
          }
        }
      } catch (e) {
        if (!req.signal.aborted) {
          failed = true;
          console.error("[chat] LLM 오류", e instanceof LlmError ? e.message : e);
          send("error", { message: "응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요." });
        }
      }

      // 정상 종료, 또는 사용자가 중간에 멈춘 경우(받은 만큼 저장)
      if (!failed && text.length > 0) {
        const saved = await prisma.message.create({
          data: { conversationId: conv.id, role: "ASSISTANT", content: text },
          select: { id: true },
        });
        send("done", { messageId: saved.id });
      } else if (!failed) {
        send("error", { message: "빈 응답이 왔어요. 다시 시도해 주세요." });
      }
      try {
        controller.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 프록시 버퍼링 방지
    },
  });
}
