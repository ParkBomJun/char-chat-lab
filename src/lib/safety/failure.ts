import { LlmError } from "@/lib/llm/types";

/** 분류기 호출이 ERROR로 끝난 원인 분류. 사용자 원문·응답 본문은 담지 않는다. */
export const ERROR_KINDS = ["http_status", "provider_filter", "parse_error", "timeout"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** parse_error일 때 응답의 "모양"만(원문은 남기지 않는다) */
export type ResponseShape = {
  /** 응답 글자 수 */
  responseLength: number;
  /** 앞쪽 공백을 뺀 첫 글자가 '{' 인가 */
  startsWithBrace: boolean;
  hasCodeFence: boolean;
  /** 거절·사과 표현을 포함하는가(모델이 판정 대신 거절했을 가능성) */
  hasRefusalPattern: boolean;
};

const REFUSAL_PATTERN = /(할 수 없|수 없(습니다|어요|다)|도와드릴 수 없|제공할 수 없|죄송|거절|\bcannot\b|\bcan'?t\b|\bcan not\b|\bunable to\b|i'?m sorry|i am sorry|i won'?t|as an ai)/i;

export function describeResponseShape(raw: string): ResponseShape {
  return {
    responseLength: raw.length,
    startsWithBrace: raw.trimStart().startsWith("{"),
    hasCodeFence: raw.includes("```"),
    hasRefusalPattern: REFUSAL_PATTERN.test(raw),
  };
}

export type FailureInfo = {
  /** 위 네 가지로 가를 수 없으면 null(알 수 없는 예외) */
  errorKind: ErrorKind | null;
  /** HTTP 응답을 받았을 때만. 200으로 시작한 스트림 안의 오류는 알 수 없어 null */
  httpStatus: number | null;
  /** 마지막 청크의 finish_reason(content_filter, length, error 등). 짧은 코드값만 남긴다 */
  finishReason: string | null;
  /** errorKind=parse_error이고 응답 본문을 받은 경우의 모양 */
  shape?: ResponseShape | null;
};

export const NO_FAILURE_INFO: FailureInfo = { errorKind: null, httpStatus: null, finishReason: null };

/** 제공사/모델의 하드 필터를 알리는 오류 문구(OpenRouter 모더레이션 403, 콘텐츠 정책 등). 모델이 말로 하는 거절은 해당하지 않는다. */
export const PROVIDER_FILTER_PATTERN = /(moderation|flagged|content[_ -]?(filter|policy)|safety[_ -]?(filter|setting|block)|prohibited[_ -]?content|policy violation)/i;

/** 제공사가 안전 필터로 생성을 끊었음을 뜻하는 finish_reason 값 */
const FILTER_FINISH_REASON = /^(content[_-]?filter(ed)?|safety|blocked|prohibited[_-]?content)$/i;
export const isFilterFinishReason = (r: string | null | undefined): boolean => !!r && FILTER_FINISH_REASON.test(r.trim());

/** finish_reason은 제공사가 주는 문자열이라 DB에 넣기 전에 코드값 모양만 남기고 자른다. */
export function cleanFinishReason(r: string | null | undefined): string | null {
  if (!r) return null;
  const s = r.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
  return s || null;
}

const TIMEOUT_MESSAGE = /(timed? ?out|timeout|aborted due to timeout)/i;

function chain(e: unknown): unknown[] {
  const out: unknown[] = [];
  for (let cur: unknown = e, i = 0; cur && i < 5; i++) {
    out.push(cur);
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return out;
}

/**
 * 분류기 호출 실패(어댑터 예외, 또는 응답은 왔으나 해석 실패)를 원인별로 분류한다.
 * 우선순위: 제공사 필터 > 타임아웃 > HTTP 상태 > 형식 오류.
 * `finishReason`은 응답을 끝까지 받은 경우의 값(예외가 없고 파싱만 실패한 경우 포함).
 */
export function describeFailure(e: unknown, opts: { finishReason?: string | null; parseFailed?: boolean; rawText?: string } = {}): FailureInfo {
  const finishReason = cleanFinishReason(opts.finishReason);
  const llm = chain(e).find((x): x is LlmError => x instanceof LlmError);
  const httpStatus = llm?.status ?? null;
  const messages = chain(e).map((x) => (x instanceof Error ? x.message : String(x)));

  if (isFilterFinishReason(finishReason) || messages.some((m) => PROVIDER_FILTER_PATTERN.test(m))) {
    return { errorKind: "provider_filter", httpStatus, finishReason };
  }
  if (chain(e).some((x) => x instanceof Error && (x.name === "TimeoutError" || x.name === "AbortError")) || messages.some((m) => TIMEOUT_MESSAGE.test(m))) {
    return { errorKind: "timeout", httpStatus, finishReason };
  }
  if (httpStatus !== null) return { errorKind: "http_status", httpStatus, finishReason };
  if (opts.parseFailed) return { errorKind: "parse_error", httpStatus: null, finishReason, ...(opts.rawText === undefined ? {} : { shape: describeResponseShape(opts.rawText) }) };
  return { errorKind: null, httpStatus: null, finishReason };
}
