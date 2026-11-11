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
    expect(events.at(-1)).toMatchObject({ type: "done", usage: { inputTokens: 100, cachedInputTokens: 64, outputTokens: 7 }, meta: { reasoningChars: 0 } });
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

  it("usage.cost(OpenRouter 실제 청구액)를 읽는다. 없거나 음수면 생략", async () => {
    const run = async (usage: Record<string, unknown>) => {
      const adapter = new OpenAiCompatAdapter({
        baseUrl: "http://x/v1",
        apiKey: "k",
        fetchImpl: async () => sseResponse([chunk({ choices: [], usage }), "data: [DONE]\n\n"]),
      });
      const events = await collect(adapter.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }));
      return (events.at(-1) as { usage: Record<string, unknown> }).usage;
    };
    expect(await run({ prompt_tokens: 10, completion_tokens: 1, cost: 0.000123 })).toMatchObject({ cost: 0.000123 });
    expect(await run({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 6 } })).toMatchObject({ cacheWriteTokens: 6 });
    expect(await run({ prompt_tokens: 10, completion_tokens: 1 })).not.toHaveProperty("cost");
    expect(await run({ prompt_tokens: 10, completion_tokens: 1, cost: -1 })).not.toHaveProperty("cost");
  });
  it("usage가 없으면 null", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () => sseResponse([chunk({ choices: [{ delta: { content: "a" } }] }), "data: [DONE]\n\n"]),
    });
    const events = await collect(adapter.stream({ model: "m", messages: [] }));
    expect(events.at(-1)).toMatchObject({ type: "done", usage: null });
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

  it("★ 스트림 도중 error 청크(HTTP 200)는 오류로 던진다 — 삼키면 빈/잘린 응답이 된다", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () =>
        sseResponse([
          chunk({ choices: [{ delta: { content: "일부" } }] }),
          chunk({ error: { code: 502, message: "Provider disconnected" }, choices: [{ delta: { content: "" }, finish_reason: "error" }] }),
          "data: [DONE]\n\n",
        ]),
    });
    await expect(collect(adapter.stream({ model: "m", messages: [] }))).rejects.toMatchObject({ name: "LlmError", message: expect.stringContaining("Provider disconnected") });
  });

  it("OpenRouter식 스트림: SSE 주석 줄과, choices가 비어 있지 않은 마지막 usage 청크를 처리한다", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () =>
        sseResponse([
          ": OPENROUTER PROCESSING\n\n",
          chunk({ choices: [{ delta: { content: "안녕" } }] }),
          ": OPENROUTER PROCESSING\n\n",
          chunk({ choices: [{ delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 3 } }),
          "data: [DONE]\n\n",
        ]),
    });
    const events = await collect(adapter.stream({ model: "provider/model", messages: [] }));
    expect(events[0]).toEqual({ type: "delta", text: "안녕" });
    expect(events.at(-1)).toMatchObject({ type: "done", usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 3 }, meta: { finishReason: "stop" } });
  });

  it("★ 추론 모델: 본문 없이 추론만 오고 finish_reason=length면 meta로 원인을 알 수 있다", async () => {
    const adapter = new OpenAiCompatAdapter({
      baseUrl: "http://x",
      apiKey: "k",
      fetchImpl: async () =>
        sseResponse([
          chunk({ choices: [{ delta: { content: "", reasoning: "먼저 생각해 보면 사용자가" } }] }),
          chunk({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "더 생각" }] } }] }),
          chunk({ choices: [{ delta: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 20, completion_tokens: 32 } }),
          "data: [DONE]\n\n",
        ]),
    });
    const events = await collect(adapter.stream({ model: "m", messages: [], maxOutputTokens: 32 }));
    expect(events.filter((e) => e.type === "delta")).toHaveLength(0); // 추론 내용은 사용자에게 보내지 않는다
    const done = events.at(-1) as Extract<LlmEvent, { type: "done" }>;
    expect(done.meta?.finishReason).toBe("length");
    expect(done.meta!.reasoningChars).toBeGreaterThan(10);
    expect(done.usage?.outputTokens).toBe(32);
  });

  it("reasoningEffort를 지정했을 때만 요청에 reasoning.effort를 보낸다", async () => {
    const bodies: Record<string, unknown>[] = [];
    const mk = (reasoningEffort?: string) =>
      new OpenAiCompatAdapter({
        baseUrl: "http://x",
        apiKey: "k",
        reasoningEffort,
        fetchImpl: async (_u, init) => {
          bodies.push(JSON.parse(String(init!.body)));
          return sseResponse([chunk({ choices: [{ delta: { content: "a" } }] }), "data: [DONE]\n\n"]);
        },
      });
    await collect(mk("low").stream({ model: "m", messages: [] }));
    await collect(mk().stream({ model: "m", messages: [] }));
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    expect("reasoning" in bodies[1]).toBe(false);
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
    expect(getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m" }).lightModel).toBe("m");
    expect(getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m", LLM_CLASSIFIER_MODEL: "cheap" }).lightModel).toBe("cheap");
    expect(getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m", LLM_PROVIDER: "mock" }).adapter.name).toBe("mock");
    // 알 수 없는 추론 강도 값은 무시(요청에 보내지 않음)
    expect(() => getLlm({ LLM_API_KEY: "k", LLM_CHAT_MODEL: "m", LLM_REASONING_EFFORT: "bogus" })).not.toThrow();
  });
});
