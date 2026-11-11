import { SseParser } from "@/lib/sse";
import { LlmError, type LlmAdapter, type LlmEvent, type LlmRequest, type Usage } from "./types";

type OpenAiChunk = {
  /** OpenRouter 등은 스트림 도중 오류를 HTTP 200 위에 최상위 error 객체로 보낸다 */
  error?: { message?: unknown; code?: unknown } | null;
  choices?: {
    delta?: { content?: string | null; reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
    /** OpenRouter: 실제 청구액(USD) */
    cost?: number | null;
  } | null;
};

export type OpenAiAdapterOptions = {
  baseUrl: string;
  apiKey: string;
  /** 업스트림 전체 타임아웃(ms) */
  timeoutMs?: number;
  /**
   * 추론(reasoning) 강도. 지정하면 모든 요청에 `reasoning: { effort }`를 보낸다(OpenRouter 규약).
   * 추론 모델은 출력 토큰 한도를 추론에 먼저 써 버려 본문이 비어 올 수 있어, 낮추거나 끄는 용도다.
   */
  reasoningEffort?: string;
  /** 테스트용 주입 */
  fetchImpl?: typeof fetch;
};

/** OpenAI 호환 Chat Completions 스트리밍 어댑터. */
export class OpenAiCompatAdapter implements LlmAdapter {
  readonly name = "openai-compat";
  readonly supportsExplicitCache = false;

  constructor(private readonly opts: OpenAiAdapterOptions) {}

  async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
    const f = this.opts.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 60_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(this.opts.reasoningEffort ? { reasoning: { effort: this.opts.reasoningEffort } } : {}),
          ...(req.jsonSchema
            ? { response_format: { type: "json_schema", json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema } } }
            : {}),
        }),
        signal,
      });
    } catch (e) {
      throw new LlmError(`LLM 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok || !res.body) {
      // 응답 본문은 키·내부 정보가 섞일 수 있어 앞부분만 서버 로그용으로 남긴다.
      const text = await res.text().catch(() => "");
      throw new LlmError(`LLM 오류 ${res.status}: ${text.slice(0, 200)}`, res.status);
    }

    const parser = new SseParser();
    const decoder = new TextDecoder();
    let usage: Usage | null = null;
    let finishReason: string | null = null;
    let reasoningChars = 0;

    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const frame of parser.feed(decoder.decode(chunk, { stream: true }))) {
        if (frame.data === "[DONE]") continue;
        let parsed: OpenAiChunk;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          continue; // 깨진 프레임은 건너뛴다
        }
        if (parsed.error) {
          // 이미 200으로 시작한 스트림이라 상태 코드로는 알 수 없다. 오류를 삼키면 빈 응답이나 잘린 응답으로 보인다.
          const msg = typeof parsed.error.message === "string" ? parsed.error.message : "알 수 없는 오류";
          throw new LlmError(`LLM 스트림 오류: ${msg.slice(0, 200)}`);
        }
        const choice = parsed.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: "delta", text };
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // 추론 내용은 사용자에게 보내지 않고 글자 수만 센다(본문이 비었을 때 원인 진단용)
        const r = choice?.delta;
        for (const v of [r?.reasoning, r?.reasoning_content]) if (typeof v === "string") reasoningChars += v.length;
        if (Array.isArray(r?.reasoning_details)) reasoningChars += JSON.stringify(r.reasoning_details).length;
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            ...(typeof parsed.usage.prompt_tokens_details?.cache_write_tokens === "number" && parsed.usage.prompt_tokens_details.cache_write_tokens > 0
              ? { cacheWriteTokens: parsed.usage.prompt_tokens_details.cache_write_tokens }
              : {}),
            ...(typeof parsed.usage.cost === "number" && Number.isFinite(parsed.usage.cost) && parsed.usage.cost >= 0 ? { cost: parsed.usage.cost } : {}),
          };
        }
      }
    }
    yield { type: "done", usage, meta: { finishReason, reasoningChars } };
  }
}
