import { describe, expect, it } from "vitest";
import { OpenAiCompatAdapter } from "./openai";
import { LlmError, type LlmEvent } from "./types";
import { MockAdapter } from "./mock";
import { getLlm } from "./index";

function sseResponse(frames: string[], splitAt?: number): Response {
  const text = frames.join("");
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const cut = splitAt ?? bytes.length;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, cut));
      if (cut < bytes.length) c.enqueue(bytes.slice(cut));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

async function collect(it: AsyncGenerator<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("OpenAiCompatAdapter", () => {
  it("delta와 usage(캐시 토큰 포함)를 읽는다", async () => {
    let body: Record<string, unknown> = {};
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x/v1/",
      apiKey: "k",
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("http://x/v1/chat/completions");
        expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
        body = JSON.parse(String(init!.body));
        return sseResponse([
          chunk({ choices: [{ delta: { content: "안녕" } }] }),
          chunk({ choices: [{ delta: { content: "하세요" } }] }),
          chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 64 } } }),
          "data: [DONE]\n\n",
        ]);
      },
    });
    const events = await collect(adapter.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("안녕하세요");
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 100, cachedInputTokens: 64, outputTokens: 7 } });
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("멀티바이트 문자가 청크 중간에서 잘려도 깨지지 않는다", async () => {
    const frames = [chunk({ choices: [{ delta: { content: "한글" } }] }), "data: [DONE]\n\n"];
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () => sseResponse(frames, 30), // 한글 바이트 중간
    });
    const events = await collect(adapter.stream({ model: "m", messages: [] }));
    expect(events[0]).toEqual({ type: "delta", text: "한글" });
  });

  it("usage가 없으면 null", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () => sseResponse([chunk({ choices: [{ delta: { content: "a" } }] }), "data: [DONE]\n\n"]),
    });
    const events = await collect(adapter.stream({ model: "m", messages: [] }));
    expect(events.at(-1)).toEqual({ type: "done", usage: null });
  });

  it("HTTP 오류는 LlmError(status 포함)", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    });
    await expect(collect(adapter.stream({ model: "m", messages: [] }))).rejects.toMatchObject({
      name: "LlmError",
      status: 429,
    });
  });

  it("네트워크 오류도 LlmError로 감싼다", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(collect(adapter.stream({ model: "m", messages: [] }))).rejects.toBeInstanceOf(LlmError);
  });
});

describe("MockAdapter / getLlm", () => {
  it("mock은 delta 후 done", async () => {
    const events = await collect(new MockAdapter(0).stream({ model: "m", messages: [{ role: "user", content: "안녕" }] }));
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(1);
  });
  it("키 없으면 mock, 키 있으면 모델 필수", () => {
    expect(getLlm({}).adapter.name).toBe("mock");
    expect(() => getLlm({ LLM_API_KEY: "k" })).toThrow(/LLM_CHAT_MODEL/);
    expect(getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m" }).adapter.name).toBe("openai-compat");
    expect(getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m", LLM_PROVIDER: "mock" }).adapter.name).toBe("mock");
  });
});
