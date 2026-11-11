export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Usage = {
  inputTokens: number;
  /** 제공사가 알려주는 캐시된 입력 토큰. 모르면 0 */
  cachedInputTokens: number;
  outputTokens: number;
};

export type LlmRequest = {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** 구조화 출력(OpenAI response_format json_schema). 지원하지 않는 제공사는 프롬프트의 JSON 지시와 파서 검증에 의존 */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  signal?: AbortSignal;
};

export type LlmEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: Usage | null };

export interface LlmAdapter {
  readonly name: string;
  /** 명시적 캐시 표시가 필요한 제공사(Anthropic 등)면 true. OpenAI 호환은 자동 캐싱이라 false. */
  readonly supportsExplicitCache: boolean;
  stream(req: LlmRequest): AsyncGenerator<LlmEvent>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
