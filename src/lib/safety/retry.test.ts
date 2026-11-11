import { describe, expect, it, vi } from "vitest";
import { MockClassifier, ClassifierError, type Classifier } from "./classifier";
import { RetryingClassifier, isRetriable } from "./retry";
import { checkInput } from "./input";
import { checkOutputFinal } from "./output";

const T = 0.8;
const make = (retries = 1) => {
  const sleep = vi.fn(async () => {});
  const inner = new MockClassifier();
  const spy = vi.spyOn(inner, "classify");
  return { c: new RetryingClassifier(inner, { retries, delayMs: 300, sleep }), sleep, spy };
};

describe("isRetriable", () => {
  it("timeout·429·5xx만 재시도 대상", () => {
    const f = (errorKind: "timeout" | "http_status" | "provider_filter" | "parse_error" | null, httpStatus: number | null = null) => ({ errorKind, httpStatus, finishReason: null });
    expect(isRetriable(f("timeout"))).toBe(true);
    expect(isRetriable(f("http_status", 429))).toBe(true);
    expect(isRetriable(f("http_status", 503))).toBe(true);
    expect(isRetriable(f("http_status", 400))).toBe(false);
    expect(isRetriable(f("http_status", 403))).toBe(false);
    expect(isRetriable(f("provider_filter", 403))).toBe(false);
    expect(isRetriable(f("parse_error"))).toBe(false);
    expect(isRetriable(f(null))).toBe(false);
  });
});

describe("RetryingClassifier (mock, 실제 API 호출 없음)", () => {
  it("[[timeout-once-in]]: 1회 실패 뒤 재시도로 성공 → 재시도 정보가 결과와 이벤트에 실린다", async () => {
    const { c, sleep, spy } = make();
    const d = await checkInput("안녕 [[timeout-once-in]]", { classifier: c, threshold: T });
    expect(d.outcome).toBe("allow");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(300);
    expect(d.calls[0]).toMatchObject({ retryCount: 1 });
    expect(d.events.at(-1)).toMatchObject({ layer: "CLASSIFIER", verdict: "ALLOW", retryCount: 1 });
    expect(d.events.at(-1)?.retryExtraMs).toBeGreaterThanOrEqual(0);
  });
  it("[[500-once-in]]: 5xx도 1회 재시도", async () => {
    const { c, spy } = make();
    const d = await checkInput("[[500-once-in]]", { classifier: c, threshold: T });
    expect(d.outcome).toBe("allow");
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("★ [[timeout-in]]: 계속 실패하면 1회만 재시도하고 기존대로 fail closed, ERROR 이벤트에 재시도 횟수", async () => {
    const { c, spy } = make();
    const d = await checkInput("[[timeout-in]]", { classifier: c, threshold: T });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(d.outcome).toBe("error");
    expect(d.events.at(-1)).toMatchObject({ verdict: "ERROR", action: "blocked", errorKind: "timeout", retryCount: 1 });
    expect(d.turnScore).toBe(0);
  });
  it("★ [[500-in]]: 500이 계속되면 재시도 1회 뒤 ERROR(http_status 500)", async () => {
    const { c, spy } = make();
    const d = await checkOutputFinal("[[500-out]]", "q", { classifier: c, threshold: T });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(d.events[0]).toMatchObject({ verdict: "ERROR", action: "retracted", errorKind: "http_status", httpStatus: 500, retryCount: 1 });
  });
  it("[[429-in]]도 재시도 대상", async () => {
    const { c, spy } = make();
    await checkInput("[[429-in]]", { classifier: c, threshold: T });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("★ provider_filter·parse_error·400은 재시도하지 않는다(호출 1회, 대기 없음, retryCount 0)", async () => {
    for (const tag of ["filter", "parse", "400"]) {
      const { c, sleep, spy } = make();
      const d = await checkInput(`[[${tag}-in]]`, { classifier: c, threshold: T });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(d.events.at(-1)).toMatchObject({ verdict: "ERROR", retryCount: 0 });
    }
  });
  it("retries=0이면 재시도를 끈다", async () => {
    const { c, spy } = make(0);
    await checkInput("[[timeout-in]]", { classifier: c, threshold: T });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("정상 호출은 재시도 필드가 없고 이벤트에도 안 붙는다", async () => {
    const { c, sleep } = make();
    const d = await checkInput("안녕", { classifier: c, threshold: T });
    expect(sleep).not.toHaveBeenCalled();
    expect(d.calls[0].retryCount).toBeUndefined();
    expect(d.events.at(-1)).not.toHaveProperty("retryCount");
  });
  it("ClassifierError가 아닌 예외(HTTP 503)도 분류해 재시도한다", async () => {
    const { LlmError } = await import("@/lib/llm/types");
    let n = 0;
    const inner: Classifier = { classify: async () => { n++; throw new LlmError("LLM 오류 503", 503); } };
    await expect(new RetryingClassifier(inner, { retries: 1, delayMs: 0, sleep: async () => {} }).classify({ stage: "INPUT", text: "a" })).rejects.toBeInstanceOf(ClassifierError);
    expect(n).toBe(2);
  });
  it("재시도 로그에 입력 원문이 들어가지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { c } = make();
    await checkInput("비밀문장 [[timeout-once-in]]", { classifier: c, threshold: T });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toMatch(/재시도 1\/1: INPUT timeout/);
    expect(String(warn.mock.calls[0][0])).not.toContain("비밀문장");
    warn.mockRestore();
  });
});
