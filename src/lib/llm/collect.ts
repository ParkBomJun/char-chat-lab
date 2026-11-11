import type { LlmAdapter, LlmRequest, StreamMeta, Usage } from "./types";

/** 스트리밍 어댑터를 끝까지 읽어 전체 텍스트와 usage를 돌려준다(요약 등 비스트리밍 용도). */
export async function collectText(
  adapter: LlmAdapter,
  req: LlmRequest,
): Promise<{ text: string; usage: Usage | null; meta: StreamMeta | null }> {
  let text = "";
  let usage: Usage | null = null;
  let meta: StreamMeta | null = null;
  for await (const ev of adapter.stream(req)) {
    if (ev.type === "delta") text += ev.text;
    else {
      usage = ev.usage;
      meta = ev.meta ?? null;
    }
  }
  return { text, usage, meta };
}
