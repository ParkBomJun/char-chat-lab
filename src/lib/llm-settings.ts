import { z } from "zod";
import type { ModelPrice, PricingTable } from "@/lib/pricing";

/** 서버 안에서만 쓰는 설정(복호화된 키 포함). 화면·클라이언트로 내보내지 않는다. */
export type LlmSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  /** 비어 있으면 chatModel을 쓴다 */
  classifierModel: string;
  structuredOutput: boolean;
  /** 모델 이름 → 단가(USD/100만 토큰). src/config/pricing.json을 덮어쓴다 */
  pricing: Record<string, ModelPrice>;
};

type Env = Record<string, string | undefined>;

/**
 * 환경변수에 DB 설정을 덮어씌운 "유효 환경". 기존 getLlm(env)/getClassifier(env)를 그대로 재사용하기 위한 어댑터.
 * DB에 키가 있으면 LLM_PROVIDER=mock 같은 환경변수 강제 설정은 무시한다(화면에서 넣은 키가 안 먹는 혼란 방지).
 */
export function mergeLlmEnv(env: Env, s: LlmSettings | null): Env {
  if (!s) return env;
  const out: Env = {
    ...env,
    LLM_API_KEY: s.apiKey,
    LLM_BASE_URL: s.baseUrl,
    LLM_CHAT_MODEL: s.chatModel,
    LLM_CLASSIFIER_MODEL: s.classifierModel,
    LLM_STRUCTURED_OUTPUT: s.structuredOutput ? "on" : "off",
  };
  delete out.LLM_PROVIDER;
  return out;
}

export function mergePricing(base: PricingTable, overrides: Record<string, ModelPrice> | undefined): PricingTable {
  return { default: base.default, models: { ...base.models, ...(overrides ?? {}) } };
}

/** 화면에 보여 줄 키 표시: 끝 4자리만. 8자 미만이면 전부 가린다. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.length >= 8 ? `••••${key.slice(-4)}` : "••••";
}

/** 주소 검증: https, 또는 로컬 개발용 http(localhost·127.0.0.1). 그 밖의 http는 키가 평문으로 나가므로 거절. */
export function validateBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "주소 형식이 올바르지 않습니다. 예: https://api.openai.com/v1" };
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    return { ok: false, error: "주소는 https여야 합니다(키가 평문으로 전송되지 않도록). 로컬 테스트만 http://localhost를 허용합니다." };
  }
  if (u.username || u.password) return { ok: false, error: "주소에 계정 정보를 넣지 마세요." };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

const modelName = (label: string, optional = false) =>
  z
    .string()
    .trim()
    .max(100, `${label}은(는) 100자 이하여야 합니다.`)
    .refine((v) => optional || v.length > 0, `${label}을(를) 입력해 주세요.`)
    .refine((v) => !/\s/.test(v), `${label}에는 공백을 넣을 수 없습니다.`);

const price = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .refine((n) => Number.isFinite(n) && n >= 0 && n <= 100_000, `${label}은(는) 0 이상 100000 이하의 숫자여야 합니다.`);

const priceSet = (p: string) =>
  z.object({ in: price(`${p} 입력 단가`), cached: price(`${p} 캐시 입력 단가`), out: price(`${p} 출력 단가`) });

export type LlmFormInput = {
  baseUrl: string;
  /** 비워 두면 저장된 키를 유지 */
  apiKey: string;
  chatModel: string;
  classifierModel: string;
  structuredOutput: boolean;
  chatPrice: { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number };
  classifierPrice: { inputPer1M: number; cachedInputPer1M: number; outputPer1M: number };
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export function parseLlmForm(fd: FormData): { ok: true; data: LlmFormInput } | { ok: false; error: string } {
  const url = validateBaseUrl(str(fd, "baseUrl"));
  if (!url.ok) return url;

  const r = z
    .object({
      apiKey: z.string().trim().max(500, "API 키가 너무 깁니다."),
      chatModel: modelName("대화 모델"),
      classifierModel: modelName("분류기·요약 모델", true),
      chat: priceSet("대화 모델"),
      cls: priceSet("분류기 모델"),
    })
    .safeParse({
      apiKey: str(fd, "apiKey"),
      chatModel: str(fd, "chatModel"),
      classifierModel: str(fd, "classifierModel"),
      chat: { in: str(fd, "chatIn"), cached: str(fd, "chatCached"), out: str(fd, "chatOut") },
      cls: { in: str(fd, "clsIn"), cached: str(fd, "clsCached"), out: str(fd, "clsOut") },
    });
  if (!r.success) return { ok: false, error: r.error.issues[0].message };

  const d = r.data;
  return {
    ok: true,
    data: {
      baseUrl: url.url,
      apiKey: d.apiKey,
      chatModel: d.chatModel,
      classifierModel: d.classifierModel,
      structuredOutput: fd.get("structuredOutput") === "on",
      chatPrice: { inputPer1M: d.chat.in, cachedInputPer1M: d.chat.cached, outputPer1M: d.chat.out },
      classifierPrice: { inputPer1M: d.cls.in, cachedInputPer1M: d.cls.cached, outputPer1M: d.cls.out },
    },
  };
}

/** 저장 형식으로 변환. 분류기 모델이 비었거나 대화 모델과 같으면 단가는 대화 모델 것만 둔다. */
export function toSettings(input: LlmFormInput, apiKey: string): LlmSettings {
  const cls = input.classifierModel || input.chatModel;
  const pricing: Record<string, ModelPrice> = { [input.chatModel]: input.chatPrice };
  if (cls !== input.chatModel) pricing[cls] = input.classifierPrice;
  return {
    baseUrl: input.baseUrl,
    apiKey,
    chatModel: input.chatModel,
    classifierModel: input.classifierModel,
    structuredOutput: input.structuredOutput,
    pricing,
  };
}

/** 에러 메시지에서 키가 새지 않도록 가리고 길이를 줄인다. */
export function redact(message: string, secret: string | null | undefined): string {
  let m = message;
  if (secret && secret.length >= 6) m = m.split(secret).join("***");
  m = m.replace(/(sk-|key-|Bearer\s+)[A-Za-z0-9_\-]{8,}/g, "$1***");
  return m.length > 240 ? `${m.slice(0, 240)}…` : m;
}

export const PRESETS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", structuredOutput: true },
  /** OpenRouter: 모델마다 구조화 출력(json_schema) 지원이 달라 미지원 모델은 요청이 오류로 실패한다 → 기본 off */
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", structuredOutput: false },
} as const;

/** OpenRouter 주소를 잘못 넣은 흔한 경우(예: https://openrouter.ai/v1)를 알려 준다. 맞으면 null. */
export function baseUrlHint(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return null;
  }
  if (/(^|\.)openrouter\.ai$/.test(u.hostname) && u.pathname.replace(/\/+$/, "") !== "/api/v1") {
    return `OpenRouter의 주소는 ${PRESETS.openrouter.baseUrl} 입니다(지금 입력한 경로는 ${u.pathname || "/"}).`;
  }
  return null;
}
