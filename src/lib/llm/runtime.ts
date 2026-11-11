import { getLlm, type LlmConfig } from "@/lib/llm";
import { mergeLlmEnv, mergePricing } from "@/lib/llm-settings";
import { pricing as basePricing, type PricingTable } from "@/lib/pricing";
import { getClassifier } from "@/lib/safety";
import type { Classifier } from "@/lib/safety/classifier";
import { loadLlmSettings } from "@/lib/settings-db";

export type Runtime = {
  llm: LlmConfig;
  classifier: Classifier;
  /** 파일 단가 위에 화면에서 입력한 단가를 덮은 표 */
  pricing: PricingTable;
  /** 어디의 설정을 쓰고 있나: 관리자 화면(DB) / 환경변수 / 키 없음(mock) */
  source: "db" | "env" | "mock";
};

/**
 * 요청 시점의 LLM 설정 해석. 우선순위: 관리자 화면(DB) > 환경변수 > mock.
 * 기존 getLlm(env)·getClassifier(env)를 그대로 쓰므로 키가 없으면 mock, 있으면 실제 어댑터가 된다.
 */
export async function resolveRuntime(): Promise<Runtime> {
  const s = await loadLlmSettings();
  const env = mergeLlmEnv(process.env, s);
  const llm = getLlm(env);
  return {
    llm,
    classifier: getClassifier(env),
    pricing: mergePricing(basePricing, s?.pricing),
    source: s ? "db" : llm.adapter.name === "mock" ? "mock" : "env",
  };
}
