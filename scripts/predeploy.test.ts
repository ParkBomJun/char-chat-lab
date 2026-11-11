import { describe, expect, it } from "vitest";
import { checkDeployEnv } from "./predeploy-lib";

const good = {
  DATABASE_URL: "postgresql://u:p@db:5432/x",
  AUTH_SECRET: "x".repeat(44),
  AUTH_TRUST_HOST: "true",
  DEMO_PASSWORD: "a-long-demo-password-9",
  ADMIN_PASSWORD: "a-different-long-admin-pw-7",
  LLM_API_KEY: "k",
  LLM_CHAT_MODEL: "m1",
  LLM_CLASSIFIER_MODEL: "m2",
  TRUST_PROXY_HOPS: "1",
  CONTACT_EMAIL: "a@b.c",
};
const errors = (env: Record<string, string | undefined>, priced: string[] = ["m1", "m2"]) =>
  checkDeployEnv(env, { pricedModels: priced }).filter((f) => f.level === "error").map((f) => f.message);

describe("predeploy 점검", () => {
  it("올바른 설정은 오류도 경고도 없다", () => {
    expect(checkDeployEnv(good, { pricedModels: ["m1", "m2"] })).toEqual([]);
  });
  it("DB 설정: DATABASE_URL 또는 compose용 POSTGRES_PASSWORD 중 하나는 필요, 약한 비밀번호는 오류", () => {
    const { DATABASE_URL: _drop, ...noUrl } = good;
    void _drop;
    expect(errors(noUrl).join()).toContain("POSTGRES_PASSWORD");
    expect(errors({ ...noUrl, POSTGRES_PASSWORD: "a-strong-db-password-1" })).toEqual([]);
    expect(errors({ ...noUrl, POSTGRES_PASSWORD: "chatlab" }).join()).toContain("약합니다");
  });
  it("AUTH_SECRET 누락·짧음", () => {
    expect(errors({ ...good, AUTH_SECRET: "" })[0]).toContain("AUTH_SECRET");
    expect(errors({ ...good, AUTH_SECRET: "short" })[0]).toContain("짧습니다");
  });
  it("★ .env.example의 개발용 비밀번호 그대로면 오류", () => {
    expect(errors({ ...good, ADMIN_PASSWORD: "admin-password-1234" }).join()).toContain("개발용 값");
    expect(errors({ ...good, DEMO_PASSWORD: "demo-password-1234" }).join()).toContain("개발용 값");
  });
  it("비밀번호 길이·관리자/데모 동일 비밀번호", () => {
    expect(errors({ ...good, ADMIN_PASSWORD: "short-pw" }).join()).toContain("12자 미만");
    expect(errors({ ...good, ADMIN_PASSWORD: good.DEMO_PASSWORD }).join()).toContain("같은 비밀번호");
  });
  it("프록시 뒤 로그인 설정(AUTH_URL 또는 AUTH_TRUST_HOST) 필수", () => {
    expect(errors({ ...good, AUTH_TRUST_HOST: undefined }).join()).toContain("AUTH_URL");
    expect(errors({ ...good, AUTH_TRUST_HOST: undefined, AUTH_URL: "https://x.example" })).toEqual([]);
  });
  it("키가 있는데 모델이 없으면 오류, 키가 없으면 경고만", () => {
    expect(errors({ ...good, LLM_CHAT_MODEL: "" }).join()).toContain("LLM_CHAT_MODEL");
    const none = checkDeployEnv({ ...good, LLM_API_KEY: "" });
    expect(none.filter((f) => f.level === "error")).toEqual([]);
    expect(none.some((f) => f.message.includes("mock"))).toBe(true);
  });
  it("단가표에 없는 모델은 경고(비용 0 기록)", () => {
    const w = checkDeployEnv(good, { pricedModels: [] }).filter((f) => f.level === "warn");
    expect(w.map((f) => f.message).join()).toContain("pricing.json");
  });
  it("일일 한도가 비정상이거나 과도하면 오류/경고", () => {
    expect(errors({ ...good, DAILY_MESSAGE_LIMIT: "0" }).join()).toContain("DAILY_MESSAGE_LIMIT");
    expect(checkDeployEnv({ ...good, DAILY_MESSAGE_LIMIT: "500" }, { pricedModels: ["m1", "m2"] })[0].level).toBe("warn");
  });
});
