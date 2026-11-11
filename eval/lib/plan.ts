/**
 * 실행 전 예상 호출 수·토큰·비용(순수 함수). 실제 호출은 하지 않는다.
 * 가정(대략치): 글자 → 토큰 환산 0.6, 응답 평균 200토큰, 분류기 호출당 프롬프트 기본 350토큰·출력 40토큰.
 * 요약 호출은 포함하지 않는다. 비용은 단가표 기준 추정이며 모델이 표에 없거나 단가가 0이면 null.
 */
import { estimateCost, type PricingTable } from "@/lib/pricing";

export type PlanInput = {
  /** 대화마다 사용자 발화 목록 */
  convs: readonly (readonly string[])[];
  fixedChars: number;
  generate: boolean;
  appSafety: boolean;
  maxOutputTokens: number;
  promptTokenBudget: number;
  chatModel: string;
  lightModel: string;
  table: PricingTable;
};
export type Plan = { turns: number; chatCalls: number; classifierCalls: number; calls: number; inputTokens: number; outputTokens: number; cost: number | null; chatCost: number | null };

export const TOKEN_SCALE = 0.6;
const AVG_REPLY_TOKENS = 200;
const CLASSIFIER_BASE_TOKENS = 350;
const CLASSIFIER_OUT_TOKENS = 40;

export function estimatePlan(p: PlanInput): Plan {
  let turns = 0;
  let chatCalls = 0;
  let classifierCalls = 0;
  const chat = { input: 0, output: 0 };
  const cls = { input: 0, output: 0 };
  for (const conv of p.convs) {
    let historyTokens = 0;
    for (const text of conv) {
      turns++;
      const userTokens = Math.ceil(text.length * TOKEN_SCALE);
      const replyTokens = Math.min(p.maxOutputTokens, AVG_REPLY_TOKENS);
      if (p.generate) {
        chatCalls++;
        chat.input += Math.min(p.promptTokenBudget, Math.ceil(p.fixedChars * TOKEN_SCALE) + historyTokens + userTokens);
        chat.output += replyTokens;
      }
      if (p.appSafety) {
        classifierCalls += p.generate ? 2 : 1; // 입력 검사 + (생성하면) 출력 검사
        cls.input += CLASSIFIER_BASE_TOKENS + userTokens;
        cls.output += CLASSIFIER_OUT_TOKENS;
        if (p.generate) {
          cls.input += CLASSIFIER_BASE_TOKENS + replyTokens + userTokens;
          cls.output += CLASSIFIER_OUT_TOKENS;
        }
      }
      historyTokens += userTokens + (p.generate ? replyTokens : 0);
    }
  }
  const price = (model: string, t: { input: number; output: number }) => {
    if (t.input + t.output === 0) return 0;
    const r = estimateCost(model, { inputTokens: t.input, cachedInputTokens: 0, outputTokens: t.output }, p.table);
    return r.priced && r.cost > 0 ? r.cost : null;
  };
  const chatCost = price(p.chatModel, chat);
  const clsCost = price(p.lightModel, cls);
  return {
    turns,
    chatCalls,
    classifierCalls,
    calls: chatCalls + classifierCalls,
    inputTokens: chat.input + cls.input,
    outputTokens: chat.output + cls.output,
    cost: chatCost === null || clsCost === null ? null : chatCost + clsCost,
    chatCost,
  };
}
