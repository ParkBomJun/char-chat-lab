import { estimateTokens } from "@/lib/tokens";
import type { LlmAdapter, LlmEvent, LlmRequest } from "./types";

/** API 키가 없을 때 쓰는 가짜 어댑터. 마지막 사용자 말을 받아 정해진 문장을 조금씩 흘려준다. */
export class MockAdapter implements LlmAdapter {
  readonly name = "mock";
  readonly supportsExplicitCache = false;

  constructor(private readonly delayMs = 30) {}

  async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const reply = `(mock 응답) "${last.slice(0, 40)}"라고 하셨군요. 실제 모델 키가 없어서 가짜 답변을 드리고 있어요.`;
    const input = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);

    for (let i = 0; i < reply.length; i += 4) {
      if (req.signal?.aborted) return;
      await new Promise((r) => setTimeout(r, this.delayMs));
      yield { type: "delta", text: reply.slice(i, i + 4) };
    }
    yield {
      type: "done",
      usage: { inputTokens: input, cachedInputTokens: 0, outputTokens: estimateTokens(reply) },
    };
  }
}
