import { loadConfig } from "@/lib/config";
import { getLlm, type LlmConfig } from "@/lib/llm";
import { mergeLlmEnv, mergePricing } from "@/lib/llm-settings";
import { pricing as basePricing, type PricingTable } from "@/lib/pricing";
import { getClassifier } from "@/lib/safety";
import type { Classifier } from "@/lib/safety/classifier";
import { loadLlmSettings } from "@/lib/settings-db";
import { effectiveEnv, isRealLlmBlocked } from "@/lib/test-guard";

export type Runtime = {
  llm: LlmConfig;
  classifier: Classifier;
  /** 파일 단가 위에 화면에서 입력한 단가를 덮은 표 */
  pricing: PricingTable;
  /** 대화 응답의 최대 출력 토큰: 화면 설정 > MAX_OUTPUT_TOKENS */
  maxOutputTokens: number;
  /** 어디의 설정을 쓰고 있나: 관리자 화면(DB) / 환경변수 / 키 없음(mock) */
  source: "db" | "env" | "mock";
};

/**
 * 요청 시점의 LLM 설정 해석. 우선순위: 관리자 화면(DB) > 환경변수 > mock.
 * 기존 getLlm(env)·getClassifier(env)를 그대로 쓰므로 키가 없으면 mock, 있으면 실제 어댑터가 된다.
 */
export async function resolveRuntime(): Promise<Runtime> {
  // 테스트 환경(APP_ENV=test)은 ALLOW_REAL_LLM=1이 없으면 DB에 저장된 키도, 환경변수 키도 무시하고 mock만 쓴다.
  const blocked = isRealLlmBlocked();
  const s = blocked ? null : await loadLlmSettings();
  const env = mergeLlmEnv(effectiveEnv(), s);
  const llm = getLlm(env);
  return {
    llm,
    classifier: getClassifier(env),
    pricing: mergePricing(basePricing, s?.pricing),
    maxOutputTokens: s?.maxOutputTokens || loadConfig().maxOutputTokens,
    source: s ? "db" : llm.adapter.name === "mock" ? "mock" : "env",
  };
}
