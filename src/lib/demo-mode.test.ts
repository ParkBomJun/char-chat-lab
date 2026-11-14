import { describe, expect, it } from "vitest";
import { demoNoticeEnabled, isSharedDemoAccount, signupEnabled } from "./demo-mode";

describe("SIGNUP_ENABLED", () => {
  it("없거나 비어 있으면 켬(기본값)", () => {
    expect(signupEnabled({})).toBe(true);
    expect(signupEnabled({ SIGNUP_ENABLED: "" })).toBe(true);
    expect(signupEnabled({ SIGNUP_ENABLED: "true" })).toBe(true);
  });
  it("false·0·off·no는 끔(대소문자·공백 무시)", () => {
    for (const v of ["false", "FALSE", " false ", "0", "off", "no"]) expect(signupEnabled({ SIGNUP_ENABLED: v })).toBe(false);
  });
});

describe("DEMO_NOTICE", () => {
  it("기본은 끔, true·1만 켬", () => {
    expect(demoNoticeEnabled({})).toBe(false);
    expect(demoNoticeEnabled({ DEMO_NOTICE: "false" })).toBe(false);
    expect(demoNoticeEnabled({ DEMO_NOTICE: "true" })).toBe(true);
    expect(demoNoticeEnabled({ DEMO_NOTICE: "1" })).toBe(true);
  });
  it("안내는 스위치가 켜져 있고 로그인한 계정이 DEMO_EMAIL일 때만", () => {
    const env = { DEMO_NOTICE: "true", DEMO_EMAIL: "Demo@Example.com" };
    expect(isSharedDemoAccount("demo@example.com", env)).toBe(true);
    expect(isSharedDemoAccount("admin@example.com", env)).toBe(false);
    expect(isSharedDemoAccount(null, env)).toBe(false);
    expect(isSharedDemoAccount("demo@example.com", { ...env, DEMO_NOTICE: "false" })).toBe(false);
    expect(isSharedDemoAccount("", { DEMO_NOTICE: "true" })).toBe(false);
  });
});
