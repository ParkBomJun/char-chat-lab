import { ClassifierError, type Classifier, type ClassifyCall, type ClassifyInput } from "./classifier";
import { describeFailure, type FailureInfo } from "./failure";

export type RetryOptions = {
  /** 최대 재시도 횟수(첫 시도 제외). 0이면 재시도 안 함 */
  retries: number;
  /** 재시도 전 대기(ms) */
  delayMs: number;
  /** 테스트용 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 재시도할 만한 일시적 장애인가: 타임아웃, HTTP 429, HTTP 5xx.
 * provider_filter(같은 입력이면 같은 결과)·parse_error(재시도해도 같은 형식 위반이 잦고 호출만 늘어남)·4xx(설정·요청 문제)는 재시도하지 않는다.
 */
export function isRetriable(f: FailureInfo): boolean {
  if (f.errorKind === "timeout") return true;
  return f.errorKind === "http_status" && f.httpStatus !== null && (f.httpStatus === 429 || f.httpStatus >= 500);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 분류기 호출을 감싸 일시적 장애(timeout / 429 / 5xx)를 짧은 대기 뒤 최대 `retries`회 다시 시도한다.
 * 그래도 실패하면 마지막 오류를 그대로 던져 호출 측이 기존대로 fail closed 처리한다.
 * 결과(성공·실패 모두)에 재시도 횟수와 재시도로 늘어난 지연(첫 시도 시작~마지막 시도 시작)을 실어 보낸다.
 */
export class RetryingClassifier implements Classifier {
  constructor(
    private readonly inner: Classifier,
    private readonly opts: RetryOptions,
  ) {}

  async classify(input: ClassifyInput): Promise<ClassifyCall> {
    const sleep = this.opts.sleep ?? realSleep;
    const t0 = Date.now();
    let retries = 0;
    for (;;) {
      const attemptStart = Date.now();
      try {
        const call = await this.inner.classify(input);
        return retries > 0 ? { ...call, retryCount: retries, retryExtraMs: attemptStart - t0 } : call;
      } catch (e) {
        const err = e instanceof ClassifierError ? e : new ClassifierError(`분류기 호출 실패: ${e instanceof Error ? e.message : String(e)}`, { cause: e, failure: describeFailure(e) });
        const f = err.failure.errorKind !== null ? err.failure : describeFailure(err.cause ?? err);
        if (retries >= this.opts.retries || !isRetriable(f)) {
          err.retryCount = retries;
          err.retryExtraMs = retries > 0 ? attemptStart - t0 : 0;
          throw err;
        }
        retries++;
        // 로그에는 원인 코드만. 입력 원문·응답 본문은 남기지 않는다.
        console.warn(`[safety] 분류기 재시도 ${retries}/${this.opts.retries}: ${input.stage} ${f.errorKind}${f.httpStatus ? ` ${f.httpStatus}` : ""}, ${this.opts.delayMs}ms 대기`);
        await sleep(this.opts.delayMs);
      }
    }
  }
}
