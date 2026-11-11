import { loadConfig } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { LlmClassifier, MockClassifier, type Classifier } from "./classifier";
import { RetryingClassifier } from "./retry";

type Env = Record<string, string | undefined>;

/** 대화 모델과 별개의 호출로 판정한다. 어댑터가 mock이면 결정적 MockClassifier. */
export function getClassifier(env: Env = process.env): Classifier {
  const llm = getLlm(env);
  const cfg = loadConfig(env);
  // 일시적 장애(timeout·429·5xx)는 짧게 한 번 더 시도하고, 그래도 안 되면 호출 측이 fail closed 처리한다.
  const retry = { retries: cfg.classifierRetries, delayMs: cfg.classifierRetryDelayMs };
  if (llm.adapter.name === "mock") return new RetryingClassifier(new MockClassifier(), retry);
  return new RetryingClassifier(
    new LlmClassifier(llm.adapter, llm.lightModel, { timeoutMs: cfg.classifierTimeoutMs, structuredOutput: env.LLM_STRUCTURED_OUTPUT !== "off" }),
    retry,
  );
}
