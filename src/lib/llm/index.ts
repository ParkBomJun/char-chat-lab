import { MockAdapter } from "./mock";
import { OpenAiCompatAdapter } from "./openai";
import type { LlmAdapter } from "./types";

import { REASONING_EFFORTS } from "./reasoning";

export type LlmConfig = {
  adapter: LlmAdapter;
  chatModel: string;
  /** 요약·분류기 같은 보조 호출용 저가 모델. LLM_CLASSIFIER_MODEL, 비어 있으면 chatModel */
  lightModel: string;
};

/**
 * LLM_API_KEY가 있으면 OpenAI 호환 어댑터, 없으면 mock.
 * LLM_PROVIDER=mock 으로 키가 있어도 강제로 mock을 쓸 수 있다.
 */
type LlmEnv = Record<string, string | undefined>;

export function getLlm(env: LlmEnv = process.env): LlmConfig {
  const key = env.LLM_API_KEY?.trim();
  if (env.LLM_PROVIDER !== "mock" && key) {
    const model = env.LLM_CHAT_MODEL?.trim();
    if (!model) throw new Error("LLM_API_KEY는 있는데 LLM_CHAT_MODEL이 비어 있습니다.");
    return {
      adapter: new OpenAiCompatAdapter({
        baseUrl: env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
        apiKey: key,
        reasoningEffort: REASONING_EFFORTS.find((e) => e === env.LLM_REASONING_EFFORT?.trim()),
      }),
      chatModel: model,
      lightModel: env.LLM_CLASSIFIER_MODEL?.trim() || model,
    };
  }
  return { adapter: new MockAdapter(), chatModel: "mock-model", lightModel: "mock-model" };
}
