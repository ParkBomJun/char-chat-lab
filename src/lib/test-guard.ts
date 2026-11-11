/**
 * 테스트 환경 가드. 테스트·E2E가 개발 DB를 건드리거나 실제 LLM을 호출하지 못하게 하는 단일 출처.
 *  - APP_ENV=test 이면 DATABASE_URL은 반드시 이름이 `_test`로 끝나는 DB여야 한다(아니면 즉시 예외).
 *  - APP_ENV=test 이면 ALLOW_REAL_LLM=1 이 명시되지 않는 한 실제 LLM 호출은 전부 막고 mock만 쓴다
 *    (환경변수의 키는 물론, DB에 저장된 키도 무시).
 */
type Env = Record<string, string | undefined>;

export const isTestEnv = (env: Env = process.env) => env.APP_ENV === "test";

/** 테스트 환경이고 실제 호출이 명시적으로 허용되지 않았으면 true */
export const isRealLlmBlocked = (env: Env = process.env) => isTestEnv(env) && env.ALLOW_REAL_LLM !== "1";

/** 실제 호출이 막혀 있으면 키를 비우고 mock을 강제한 환경을, 아니면 그대로 돌려준다. */
export function effectiveEnv(env: Env = process.env): Env {
  return isRealLlmBlocked(env) ? { ...env, LLM_PROVIDER: "mock", LLM_API_KEY: "" } : env;
}

export function databaseNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name || null;
  } catch {
    return null;
  }
}

export const isTestDatabaseUrl = (url: string | undefined) => /_test$/.test(databaseNameOf(url) ?? "");

/** APP_ENV=test인데 테스트 DB가 아니면 던진다. DB 모듈이 로드될 때 호출한다. */
export function assertDatabaseMatchesEnv(env: Env = process.env): void {
  if (isTestEnv(env) && !isTestDatabaseUrl(env.DATABASE_URL)) {
    throw new Error(
      `APP_ENV=test인데 DATABASE_URL의 DB 이름("${databaseNameOf(env.DATABASE_URL) ?? "알 수 없음"}")이 _test로 끝나지 않습니다. ` +
        "개발 DB를 보호하기 위해 중단합니다. 테스트는 `npm run dev:test` 등 scripts/test-run.ts를 통해 실행하세요.",
    );
  }
}
