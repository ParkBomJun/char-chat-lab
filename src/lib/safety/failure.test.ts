import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@/lib/llm/types";
import type { LlmAdapter, LlmEvent } from "@/lib/llm/types";
import { describeFailure, cleanFinishReason, isFilterFinishReason } from "./failure";
import { ClassifierError, LlmClassifier, MockClassifier, type Classifier } from "./classifier";
import { checkInput } from "./input";
import { checkOutputFinal } from "./output";

describe("describeFailure: 원인 분류", () => {
  it("HTTP 오류는 http_status와 상태 코드", () => {
    expect(describeFailure(new LlmError("LLM 오류 429: slow down", 429))).toEqual({ errorKind: "http_status", httpStatus: 429, finishReason: null });
  });
  it("모더레이션 거절 문구는 상태 코드를 유지한 채 provider_filter", () => {
    expect(describeFailure(new LlmError("LLM 오류 403: {\"error\":\"input was flagged by moderation\"}", 403))).toEqual({ errorKind: "provider_filter", httpStatus: 403, finishReason: null });
  });
  it("finish_reason=content_filter면 본문 없이도 provider_filter", () => {
    expect(describeFailure(null, { finishReason: "content_filter" })).toEqual({ errorKind: "provider_filter", httpStatus: null, finishReason: "content_filter" });
    expect(describeFailure(null, { finishReason: "SAFETY", parseFailed: true }).errorKind).toBe("provider_filter");
  });
  it("타임아웃: DOMException 이름 또는 cause 체인", () => {
    expect(describeFailure(new DOMException("The operation was aborted due to timeout", "TimeoutError")).errorKind).toBe("timeout");
    const wrapped = new LlmError("LLM 요청 실패: x", undefined, { cause: new DOMException("t", "TimeoutError") });
    expect(describeFailure(wrapped)).toEqual({ errorKind: "timeout", httpStatus: null, finishReason: null });
  });
  it("응답은 왔으나 해석 실패면 parse_error와 finish_reason", () => {
    expect(describeFailure(null, { finishReason: "length", parseFailed: true })).toEqual({ errorKind: "parse_error", httpStatus: null, finishReason: "length" });
  });
  it("알 수 없는 예외는 errorKind null", () => {
    expect(describeFailure(new Error("boom"))).toEqual({ errorKind: null, httpStatus: null, finishReason: null });
  });
  it("finish_reason은 코드값 모양만 남긴다(본문이 섞여 들어가지 않게)", () => {
    expect(cleanFinishReason("Content_Filter")).toBe("content_filter");
    expect(cleanFinishReason("  stop \n본문 일부 !!")).toBe("stop");
    expect(cleanFinishReason("x".repeat(100))?.length).toBe(40);
    expect(isFilterFinishReason("stop")).toBe(false);
  });
});

describe("LlmClassifier → ClassifierError.failure", () => {
  const opts = { timeoutMs: 1000, structuredOutput: true };
  const adapter = (events: LlmEvent[] | Error): LlmAdapter => ({
    name: "t",
    supportsExplicitCache: false,
    async *stream(): AsyncGenerator<LlmEvent> {
      if (events instanceof Error) throw events;
      yield* events;
    },
  });
  const done = (finishReason: string | null, usage = null): LlmEvent => ({ type: "done", usage, meta: { finishReason, reasoningChars: 0 } });
  const fail = async (a: LlmAdapter) => {
    try {
      await new LlmClassifier(a, "m", opts).classify({ stage: "INPUT", text: "안녕" });
    } catch (e) {
      return e as ClassifierError;
    }
    throw new Error("실패해야 함");
  };

  it("HTTP 500 → http_status/500", async () => {
    expect((await fail(adapter(new LlmError("LLM 오류 500: x", 500)))).failure).toEqual({ errorKind: "http_status", httpStatus: 500, finishReason: null });
  });
  it("finish_reason=content_filter(본문 비어 있음) → provider_filter", async () => {
    expect((await fail(adapter([done("content_filter")]))).failure).toEqual({ errorKind: "provider_filter", httpStatus: null, finishReason: "content_filter" });
  });
  it("finish_reason=content_filter이면 본문이 JSON처럼 보여도 통과시키지 않는다", async () => {
    const ok = '{"verdict":"allow","category":"none","score":0,"reason":"r"}';
    expect((await fail(adapter([{ type: "delta", text: ok }, done("content_filter")]))).failure.errorKind).toBe("provider_filter");
  });
  it("JSON이 아니면 parse_error(finish_reason 포함)", async () => {
    expect((await fail(adapter([{ type: "delta", text: "죄송합니다" }, done("length")]))).failure).toEqual({ errorKind: "parse_error", httpStatus: null, finishReason: "length" });
  });
  it("타임아웃 → timeout", async () => {
    expect((await fail(adapter(new DOMException("t", "TimeoutError")))).failure.errorKind).toBe("timeout");
  });
  it("실패 이유에 사용자 입력 원문이 들어가지 않는다", async () => {
    const e = await fail(adapter([{ type: "delta", text: "원문 ‘안녕’ 은 안전" }, done("stop")]));
    expect(JSON.stringify(e.failure)).not.toContain("안녕");
  });
});

describe("ERROR 이벤트에 원인이 실린다", () => {
  const T = 0.8;
  const throwing = (e: Error): Classifier => ({ classify: vi.fn(async () => { throw e; }) });
  it("입력: provider_filter", async () => {
    const d = await checkInput("안녕", { classifier: throwing(new ClassifierError("f", { failure: { errorKind: "provider_filter", httpStatus: null, finishReason: "content_filter" } })), threshold: T });
    expect(d.events.at(-1)).toEqual({ stage: "INPUT", layer: "CLASSIFIER", verdict: "ERROR", category: null, score: null, action: "blocked", errorKind: "provider_filter", httpStatus: null, finishReason: "content_filter", retryCount: 0, retryExtraMs: 0 });
  });
  it("출력: 분류기가 아닌 LlmError도 분류한다", async () => {
    const d = await checkOutputFinal("응답", "질문", { classifier: throwing(new LlmError("LLM 오류 503", 503)), threshold: T });
    expect(d.events[0]).toMatchObject({ verdict: "ERROR", action: "retracted", errorKind: "http_status", httpStatus: 503 });
  });
  it("원인을 알 수 없으면 errorKind null", async () => {
    const d = await checkInput("안녕", { classifier: throwing(new Error("boom")), threshold: T });
    expect(d.events.at(-1)).toMatchObject({ verdict: "ERROR", errorKind: null, httpStatus: null, finishReason: null });
  });
  it("mock 표식: [[filter-in]] [[timeout-out]] [[parse-in]]", async () => {
    const m = new MockClassifier();
    expect((await checkInput("[[filter-in]]", { classifier: m, threshold: T })).events.at(-1)).toMatchObject({ errorKind: "provider_filter", finishReason: "content_filter" });
    expect((await checkOutputFinal("[[timeout-out]]", "q", { classifier: m, threshold: T })).events[0]).toMatchObject({ errorKind: "timeout" });
    expect((await checkInput("[[parse-in]]", { classifier: m, threshold: T })).events.at(-1)).toMatchObject({ errorKind: "parse_error", finishReason: "length" });
  });
  it("정상·차단 이벤트에는 오류 필드가 없다", async () => {
    const d = await checkInput("안녕", { classifier: new MockClassifier(), threshold: T });
    for (const e of d.events) expect(e).not.toHaveProperty("errorKind");
  });
});
