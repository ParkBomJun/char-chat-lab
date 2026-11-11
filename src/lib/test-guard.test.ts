import { describe, expect, it } from "vitest";
import { assertDatabaseMatchesEnv, databaseNameOf, effectiveEnv, isRealLlmBlocked, isTestDatabaseUrl } from "./test-guard";

const DEV = "postgresql://chatlab:chatlab@localhost:5433/chatlab?schema=public";
const TEST = "postgresql://chatlab:x@localhost:5434/chatlab_test?schema=public";

describe("테스트 DB 가드", () => {
  it("DB 이름을 URL에서 뽑고 _test 여부를 판정", () => {
    expect(databaseNameOf(DEV)).toBe("chatlab");
    expect(databaseNameOf(TEST)).toBe("chatlab_test");
    expect(isTestDatabaseUrl(TEST)).toBe(true);
    expect(isTestDatabaseUrl(DEV)).toBe(false);
    expect(isTestDatabaseUrl(undefined)).toBe(false);
    expect(isTestDatabaseUrl("garbage")).toBe(false);
    expect(isTestDatabaseUrl("postgresql://u:p@h/chatlab_test_backup")).toBe(false); // 접미사만 인정
  });
  it("★ APP_ENV=test인데 개발 DB면 예외", () => {
    expect(() => assertDatabaseMatchesEnv({ APP_ENV: "test", DATABASE_URL: DEV })).toThrow(/_test/);
    expect(() => assertDatabaseMatchesEnv({ APP_ENV: "test", DATABASE_URL: undefined })).toThrow();
    expect(() => assertDatabaseMatchesEnv({ APP_ENV: "test", DATABASE_URL: TEST })).not.toThrow();
  });
  it("APP_ENV가 test가 아니면 가드는 관여하지 않는다(개발·운영)", () => {
    expect(() => assertDatabaseMatchesEnv({ DATABASE_URL: DEV })).not.toThrow();
    expect(() => assertDatabaseMatchesEnv({ APP_ENV: "production", DATABASE_URL: DEV })).not.toThrow();
  });
});

describe("실제 LLM 호출 가드", () => {
  it("★ 테스트 환경은 ALLOW_REAL_LLM=1 없이는 실제 호출이 막힌다", () => {
    expect(isRealLlmBlocked({ APP_ENV: "test" })).toBe(true);
    expect(isRealLlmBlocked({ APP_ENV: "test", ALLOW_REAL_LLM: "0" })).toBe(true);
    expect(isRealLlmBlocked({ APP_ENV: "test", ALLOW_REAL_LLM: "1" })).toBe(false);
    expect(isRealLlmBlocked({})).toBe(false);
  });
  it("막혀 있으면 환경의 키를 비우고 mock을 강제한다", () => {
    const e = effectiveEnv({ APP_ENV: "test", LLM_API_KEY: "sk-real", LLM_CHAT_MODEL: "m" });
    expect(e.LLM_API_KEY).toBe("");
    expect(e.LLM_PROVIDER).toBe("mock");
    expect(effectiveEnv({ APP_ENV: "test", ALLOW_REAL_LLM: "1", LLM_API_KEY: "sk-real" }).LLM_API_KEY).toBe("sk-real");
    expect(effectiveEnv({ LLM_API_KEY: "k" }).LLM_API_KEY).toBe("k");
  });
});
