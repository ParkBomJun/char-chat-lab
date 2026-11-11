"use server";

import { requireAdmin } from "@/lib/admin/guard";
import { LlmClassifier } from "@/lib/safety/classifier";
import { OpenAiCompatAdapter } from "@/lib/llm/openai";
import { collectText } from "@/lib/llm/collect";
import { loadConfig } from "@/lib/config";
import { baseUrlHint, explainEmptyResponse, parseLlmForm, redact, toSettings } from "@/lib/llm-settings";
import { clearLlmSettings, loadLlmSettingsFresh, saveLlmSettings } from "@/lib/settings-db";

export type SaveResult = { ok: true; message: string } | { ok: false; error: string };
export type CheckResult = { name: string; ok: boolean; detail: string; ms: number };
export type TestResult = { ok: false; error: string } | { ok: true; checks: CheckResult[]; hint: string | null };

/** 서버 액션은 URL로 직접 호출될 수 있으므로 모든 액션이 스스로 관리자 확인을 한다. API 키는 이 파일 밖(클라이언트)으로 나가지 않는다. */
export async function saveLlmAction(fd: FormData): Promise<SaveResult> {
  await requireAdmin();
  const parsed = parseLlmForm(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { settings: existing } = await loadLlmSettingsFresh();
  const apiKey = parsed.data.apiKey || existing?.apiKey || "";
  if (!apiKey) return { ok: false, error: "API 키를 입력해 주세요." };

  try {
    await saveLlmSettings(toSettings(parsed.data, apiKey));
  } catch (e) {
    return { ok: false, error: redact(e instanceof Error ? e.message : "저장하지 못했습니다.", apiKey) };
  }
  return { ok: true, message: "저장했습니다. 이제 새 대화부터 이 설정으로 응답합니다." };
}

/** 저장된 설정을 지우고 환경변수 설정(없으면 mock)으로 되돌린다. */
export async function clearLlmAction(): Promise<SaveResult> {
  await requireAdmin();
  await clearLlmSettings();
  return { ok: true, message: "화면 설정을 삭제했습니다. 환경변수 설정(없으면 가짜 응답)으로 돌아갑니다." };
}

const TIMEOUT_MS = 25_000;

/**
 * 저장 전 연결 테스트. 폼에 입력된 값(키를 비우면 저장된 키)으로 실제 호출을 해 본다.
 *  1) 대화 모델이 응답하는가  2) 분류기 모델이 안전 판정 JSON을 올바른 형식으로 돌려주는가(fail closed라 형식이 틀리면 모든 입력이 막힌다)
 */
export async function testLlmAction(fd: FormData): Promise<TestResult> {
  await requireAdmin();
  const parsed = parseLlmForm(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { settings: existing } = await loadLlmSettingsFresh();
  const apiKey = parsed.data.apiKey || existing?.apiKey || "";
  if (!apiKey) return { ok: false, error: "테스트할 API 키가 없습니다. 키를 입력해 주세요." };

  const d = parsed.data;
  // 실제 대화와 같은 조건으로 시험해야 의미가 있다: 추론 강도와 최대 출력 토큰을 그대로 쓴다.
  const maxOut = d.maxOutputTokens || loadConfig().maxOutputTokens;
  const adapter = new OpenAiCompatAdapter({ baseUrl: d.baseUrl, apiKey, timeoutMs: TIMEOUT_MS, reasoningEffort: d.reasoningEffort || undefined });
  const clsModel = d.classifierModel || d.chatModel;
  const checks: CheckResult[] = [];

  const t1 = Date.now();
  try {
    const { text, usage, meta } = await collectText(adapter, {
      model: d.chatModel,
      messages: [{ role: "user", content: "한 단어로만 대답해 주세요: 안녕" }],
      maxOutputTokens: maxOut,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ok = text.trim().length > 0;
    checks.push({
      name: `대화 모델 (${d.chatModel})`,
      ok,
      detail: ok
        ? `응답: "${text.trim().slice(0, 30)}"${usage ? ` · 입력 ${usage.inputTokens}/출력 ${usage.outputTokens}토큰` : " · usage 정보 없음(비용은 글자 수로 추정됨)"}${meta && meta.reasoningChars > 0 ? " · 추론 사용됨(느릴 수 있음)" : ""}`
        : explainEmptyResponse(meta, usage, maxOut),
      ms: Date.now() - t1,
    });
  } catch (e) {
    checks.push({ name: `대화 모델 (${d.chatModel})`, ok: false, detail: redact(e instanceof Error ? e.message : String(e), apiKey), ms: Date.now() - t1 });
  }

  const t2 = Date.now();
  try {
    const cls = new LlmClassifier(adapter, clsModel, { timeoutMs: TIMEOUT_MS, structuredOutput: d.structuredOutput });
    const r = await cls.classify({ stage: "INPUT", text: "안녕하세요, 오늘 날씨가 정말 좋네요." });
    checks.push({
      name: `안전 분류기 (${clsModel})`,
      ok: true,
      detail: `판정 JSON 정상 · verdict=${r.verdict.verdict}, category=${r.verdict.category}, score=${r.verdict.score}`,
      ms: Date.now() - t2,
    });
  } catch (e) {
    checks.push({ name: `안전 분류기 (${clsModel})`, ok: false, detail: redact(e instanceof Error ? e.message : String(e), apiKey), ms: Date.now() - t2 });
  }

  let hint: string | null = baseUrlHint(d.baseUrl);
  const [chat, cls] = checks;
  if (hint) {
    /* 주소가 잘못됐을 가능성이 가장 크므로 이 힌트를 우선한다 */
  } else if (!chat.ok && !cls.ok && /401|403|invalid|incorrect|unauthor/i.test(chat.detail)) hint = "키가 거절됐습니다. 키와 API 주소가 같은 제공사의 것인지 확인해 보세요.";
  else if (!chat.ok && d.reasoningEffort && /reasoning|effort|mandatory|unsupported|invalid.*param/i.test(chat.detail)) hint = "이 모델이 추론 강도 설정을 지원하지 않거나 끌 수 없는 것 같습니다. 추론 강도를 '모델 기본값'이나 다른 값(minimal/low)으로 바꿔 보세요.";
  else if (!chat.ok && /^빈 응답/.test(chat.detail)) hint = "추론(thinking) 모델은 출력 토큰을 추론에 먼저 씁니다. '추론 강도'를 low/minimal로 낮추거나 '최대 출력 토큰'을 늘려서 다시 테스트하세요. 추론을 끌 수 없는 모델도 있습니다(OpenRouter 모델 목록의 reasoning.mandatory).";
  else if (!chat.ok && /404|model/i.test(chat.detail)) hint = "모델 이름이 맞는지, 주소(/v1 까지)가 맞는지 확인해 보세요.";
  else if (chat.ok && !cls.ok && d.structuredOutput) hint = "분류기가 실패했습니다. 제공사가 json_schema 구조화 출력을 지원하지 않을 수 있습니다. '구조화 출력' 체크를 끄고 다시 테스트해 보세요.";
  else if (chat.ok && !cls.ok) hint = "분류기 모델이 판정 JSON 형식을 지키지 못했습니다. 더 지시를 잘 따르는 모델로 바꿔 보세요. 형식이 틀리면 안전 검사가 모든 입력을 차단합니다(fail closed).";
  return { ok: true, checks, hint };
}
