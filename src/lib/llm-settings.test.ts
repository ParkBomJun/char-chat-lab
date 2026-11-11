import { describe, expect, it } from "vitest";
import { getLlm } from "@/lib/llm";
import { PRESETS, baseUrlHint, explainEmptyResponse, maskKey, mergeLlmEnv, mergePricing, parseLlmForm, redact, toSettings, validateBaseUrl, type LlmSettings } from "./llm-settings";

const S: LlmSettings = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test-1234567890", chatModel: "big", classifierModel: "small", structuredOutput: true, reasoningEffort: "", maxOutputTokens: 0, pricing: {} };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const base = { baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", chatModel: "big", classifierModel: "small" };

describe("mergeLlmEnv", () => {
  it("설정이 없으면 환경변수 그대로, mock", () => {
    expect(getLlm(mergeLlmEnv({}, null)).adapter.name).toBe("mock");
  });
  it("DB 설정이 환경변수를 덮어쓰고 실제 어댑터·모델이 된다", () => {
    const llm = getLlm(mergeLlmEnv({ LLM_API_KEY: "env-key", LLM_CHAT_MODEL: "env-model" }, S));
    expect(llm.adapter.name).toBe("openai-compat");
    expect(llm.chatModel).toBe("big");
    expect(llm.lightModel).toBe("small");
  });
  it("★ DB에 키가 있으면 환경변수의 LLM_PROVIDER=mock은 무시(넣은 키가 안 먹는 혼란 방지)", () => {
    expect(getLlm(mergeLlmEnv({ LLM_PROVIDER: "mock" }, S)).adapter.name).toBe("openai-compat");
  });
  it("분류기 모델이 비어 있으면 대화 모델을 쓴다", () => {
    expect(getLlm(mergeLlmEnv({}, { ...S, classifierModel: "" })).lightModel).toBe("big");
  });
  it("구조화 출력 토글이 환경변수 규칙(off)으로 전달된다", () => {
    expect(mergeLlmEnv({}, { ...S, structuredOutput: false }).LLM_STRUCTURED_OUTPUT).toBe("off");
    expect(mergeLlmEnv({}, S).LLM_STRUCTURED_OUTPUT).toBe("on");
  });
});

describe("마스킹·가리기", () => {
  it("키는 끝 4자리만 보인다", () => {
    expect(maskKey("sk-test-1234567890")).toBe("••••7890");
    expect(maskKey("short")).toBe("••••");
    expect(maskKey(null)).toBeNull();
  });
  it("★ 오류 메시지에서 키 원문과 키처럼 생긴 문자열을 가린다", () => {
    const r = redact("401 Incorrect API key provided: sk-test-1234567890. Bearer abcdefghij1234", "sk-test-1234567890");
    expect(r).not.toContain("1234567890");
    expect(r).not.toContain("abcdefghij1234");
    expect(redact("x".repeat(500), null).length).toBeLessThan(260);
  });
});

describe("validateBaseUrl", () => {
  it("https와 localhost http만 허용", () => {
    expect(validateBaseUrl("https://api.openai.com/v1/")).toEqual({ ok: true, url: "https://api.openai.com/v1" });
    expect(validateBaseUrl("http://localhost:4010/v1")).toMatchObject({ ok: true });
    expect(validateBaseUrl("http://127.0.0.1:8080")).toMatchObject({ ok: true });
  });
  it("★ 외부 http(키가 평문 전송)·잘못된 형식·계정 정보 포함은 거절", () => {
    expect(validateBaseUrl("http://api.example.com/v1")).toMatchObject({ ok: false });
    expect(validateBaseUrl("not a url")).toMatchObject({ ok: false });
    expect(validateBaseUrl("https://user:pw@api.example.com")).toMatchObject({ ok: false });
    expect(validateBaseUrl("ftp://x.com")).toMatchObject({ ok: false });
  });
});

describe("parseLlmForm / toSettings", () => {
  it("정상 입력: 단가 빈 값은 0, 체크박스 on", () => {
    const r = parseLlmForm(fd({ ...base, chatIn: "2.5", chatOut: "10", structuredOutput: "on" }));
    expect(r).toMatchObject({ ok: true, data: { chatModel: "big", structuredOutput: true, chatPrice: { inputPer1M: 2.5, cachedInputPer1M: 0, outputPer1M: 10 } } });
  });
  it("대화 모델 누락·공백 포함·잘못된 단가·음수 거절", () => {
    expect(parseLlmForm(fd({ ...base, chatModel: "" }))).toMatchObject({ ok: false });
    expect(parseLlmForm(fd({ ...base, chatModel: "my model" }))).toMatchObject({ ok: false });
    expect(parseLlmForm(fd({ ...base, chatIn: "abc" }))).toMatchObject({ ok: false });
    expect(parseLlmForm(fd({ ...base, clsOut: "-1" }))).toMatchObject({ ok: false });
  });
  it("분류기 모델은 비워도 된다", () => {
    expect(parseLlmForm(fd({ ...base, classifierModel: "" }))).toMatchObject({ ok: true });
  });
  it("저장 형식: 분류기가 다른 모델이면 두 모델의 단가를, 같거나 비면 대화 모델 단가만", () => {
    const p = (o: Record<string, string>) => {
      const r = parseLlmForm(fd({ ...base, chatIn: "1", clsIn: "0.1", ...o }));
      if (!r.ok) throw new Error(r.error);
      return toSettings(r.data, "k").pricing;
    };
    expect(Object.keys(p({}))).toEqual(["big", "small"]);
    expect(p({}).small.inputPer1M).toBe(0.1);
    expect(Object.keys(p({ classifierModel: "" }))).toEqual(["big"]);
    expect(Object.keys(p({ classifierModel: "big" }))).toEqual(["big"]);
  });
});

describe("mergePricing", () => {
  it("파일 단가 위에 DB 단가를 덮어쓴다", () => {
    const t = mergePricing(
      { default: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 }, models: { a: { inputPer1M: 1, cachedInputPer1M: 1, outputPer1M: 1 } } },
      { b: { inputPer1M: 2, cachedInputPer1M: 2, outputPer1M: 2 }, a: { inputPer1M: 9, cachedInputPer1M: 9, outputPer1M: 9 } },
    );
    expect(Object.keys(t.models).sort()).toEqual(["a", "b"]);
    expect(t.models.a.inputPer1M).toBe(9);
  });
});

describe("OpenRouter 프리셋·주소 힌트", () => {
  it("프리셋 주소는 유효한 https이고 OpenRouter는 구조화 출력이 기본 off", () => {
    expect(validateBaseUrl(PRESETS.openrouter.baseUrl)).toEqual({ ok: true, url: "https://openrouter.ai/api/v1" });
    expect(validateBaseUrl(PRESETS.openai.baseUrl)).toMatchObject({ ok: true });
    expect(PRESETS.openrouter.structuredOutput).toBe(false);
    expect(PRESETS.openai.structuredOutput).toBe(true);
  });
  it("OpenRouter에서 경로를 잘못 넣으면 힌트, 맞거나 다른 호스트면 null", () => {
    expect(baseUrlHint("https://openrouter.ai/v1")).toContain("https://openrouter.ai/api/v1");
    expect(baseUrlHint("https://openrouter.ai")).toContain("/api/v1");
    expect(baseUrlHint("https://openrouter.ai/api/v1")).toBeNull();
    expect(baseUrlHint("https://openrouter.ai/api/v1/")).toBeNull();
    expect(baseUrlHint("https://api.openai.com/v1")).toBeNull();
    expect(baseUrlHint("garbage")).toBeNull();
  });
  it("슬래시가 든 모델 이름(provider/model)을 허용한다", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", chatModel: "provider/model-name:free", classifierModel: "other/small" })) f.set(k, v);
    expect(parseLlmForm(f)).toMatchObject({ ok: true, data: { chatModel: "provider/model-name:free" } });
  });
});

describe("추론 강도·최대 출력 토큰", () => {
  const ok = (o: Record<string, string>) => {
    const r = parseLlmForm(fd({ ...base, ...o }));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  it("기본값은 빈 문자열(보내지 않음)과 0(서버 기본값)", () => {
    expect(ok({})).toMatchObject({ reasoningEffort: "", maxOutputTokens: 0 });
  });
  it("허용된 강도와 범위 안의 토큰 수", () => {
    expect(ok({ reasoningEffort: "low", maxOutputTokens: "4096" })).toMatchObject({ reasoningEffort: "low", maxOutputTokens: 4096 });
    expect(ok({ reasoningEffort: "none" }).reasoningEffort).toBe("none");
  });
  it("알 수 없는 강도·범위 밖/비정수 토큰은 거절", () => {
    expect(parseLlmForm(fd({ ...base, reasoningEffort: "extreme" }))).toMatchObject({ ok: false });
    for (const v of ["10", "70000", "abc", "1.5", "-1"]) expect(parseLlmForm(fd({ ...base, maxOutputTokens: v }))).toMatchObject({ ok: false });
  });
  it("환경변수로 전달되고, 빈 값이면 환경변수에서 제거된다", () => {
    expect(mergeLlmEnv({}, { ...S, reasoningEffort: "minimal" }).LLM_REASONING_EFFORT).toBe("minimal");
    expect(mergeLlmEnv({ LLM_REASONING_EFFORT: "high" }, { ...S, reasoningEffort: "" }).LLM_REASONING_EFFORT).toBeUndefined();
  });
});

describe("explainEmptyResponse (빈 응답 원인 설명)", () => {
  const u = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 32 };
  it("finish_reason=length: 추론이 출력 한도를 먹었다고 설명하고 한도 값을 보여 준다", () => {
    const m = explainEmptyResponse({ finishReason: "length", reasoningChars: 120 }, u, 32);
    expect(m).toContain("finish_reason=length");
    expect(m).toContain("(32)");
    expect(m).toContain("추론 강도를 낮추");
  });
  it("추론만 받고 종료", () => {
    expect(explainEmptyResponse({ finishReason: "stop", reasoningChars: 50 }, null, 1024)).toContain("추론만 하고 본문을 보내지 않았습니다");
  });
  it("토큰은 썼는데 본문·추론 정보가 없는 경우(추론이 숨겨진 모델)", () => {
    expect(explainEmptyResponse({ finishReason: "stop", reasoningChars: 0 }, u, 1024)).toContain("토큰은 소비됐지만");
  });
  it("아무 정보도 없으면 모델·제공사 확인 안내", () => {
    expect(explainEmptyResponse(null, null, 1024)).toContain("아무 내용도 보내지 않았습니다");
  });
});
