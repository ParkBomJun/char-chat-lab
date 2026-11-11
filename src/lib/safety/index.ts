import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { LlmClassifier, MockClassifier, type Classifier } from "./classifier";

type Env = Record<string, string | undefined>;

/** 대화 모델과 별개의 호출로 판정한다. 어댑터가 mock이면 결정적 MockClassifier. */
export function getClassifier(env: Env = process.env): Classifier {
  const llm = getLlm(env);
  if (llm.adapter.name === "mock") return new MockClassifier();
  return new LlmClassifier(llm.adapter, llm.lightModel, {
    timeoutMs: loadConfig(env).classifierTimeoutMs,
    structuredOutput: env.LLM_STRUCTURED_OUTPUT !== "off",
  });
}
