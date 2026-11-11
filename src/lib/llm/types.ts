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

/** 스트림이 끝난 뒤의 진단 정보. 본문이 비어 올 때 원인을 알려 주는 데 쓴다. */
export type StreamMeta = {
  /** 마지막 청크의 finish_reason(stop | length | error 등). 알 수 없으면 null */
  finishReason: string | null;
  /** 추론(reasoning) 내용으로 받은 글자 수. 본문(delta.content)과 별개 */
  reasoningChars: number;
};

export type LlmEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: Usage | null; meta?: StreamMeta };

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
