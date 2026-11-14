import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNUP_CLOSED_MESSAGE } from "@/lib/demo-mode";

// 서버 액션이 닿는 바깥(DB, 세션, 요청 헤더, 시도 제한)을 모두 가짜로 바꿔 액션의 분기만 본다.
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  signIn: vi.fn(),
  signupThrottled: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: m.findUnique, create: m.create } } }));
vi.mock("@/auth", () => ({ signIn: m.signIn, signOut: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/rate-limit-db", () => ({ requestIp: () => "203.0.113.1", signupThrottled: m.signupThrottled }));

import { signupAction } from "./auth";

const form = (email = "new@example.com", password = "long-enough-pw") => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

describe("signupAction과 SIGNUP_ENABLED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.signupThrottled.mockResolvedValue(false);
    m.findUnique.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: "u1" });
    m.signIn.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("★ 꺼져 있으면 거부한다: 안내 문구를 돌려주고 DB·시도 제한·로그인 어디에도 닿지 않는다", async () => {
    vi.stubEnv("SIGNUP_ENABLED", "false");
    expect(await signupAction(undefined, form())).toEqual({ error: SIGNUP_CLOSED_MESSAGE });
    expect(m.signupThrottled).not.toHaveBeenCalled();
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("꺼져 있으면 입력이 잘못돼도 같은 안내만 돌려준다(형식 오류로 새지 않는다)", async () => {
    vi.stubEnv("SIGNUP_ENABLED", "false");
    expect(await signupAction(undefined, form("not-an-email", "x"))).toEqual({ error: SIGNUP_CLOSED_MESSAGE });
  });

  it.each([["지정 안 함", undefined], ["true", "true"]])("켜져 있으면(%s) 기존대로 계정을 만들고 로그인한다", async (_label, value) => {
    if (value !== undefined) vi.stubEnv("SIGNUP_ENABLED", value);
    expect(await signupAction(undefined, form("New@Example.com"))).toBeUndefined();
    expect(m.create).toHaveBeenCalledTimes(1);
    const { data } = m.create.mock.calls[0][0];
    expect(data.email).toBe("new@example.com");
    expect(data.passwordHash).not.toBe("long-enough-pw");
    expect(m.signIn).toHaveBeenCalledWith("credentials", { email: "new@example.com", password: "long-enough-pw", redirectTo: "/" });
  });

  it("켜져 있을 때의 기존 거부 사유는 그대로다: 형식 오류, 시도 제한, 이미 가입된 이메일", async () => {
    expect((await signupAction(undefined, form("new@example.com", "short")))?.error).toContain("8자 이상");
    m.signupThrottled.mockResolvedValueOnce(true);
    expect((await signupAction(undefined, form()))?.error).toContain("가입 시도가 너무 많아요");
    m.findUnique.mockResolvedValueOnce({ id: "u0" });
    expect((await signupAction(undefined, form()))?.error).toBe("이미 가입된 이메일입니다.");
    expect(m.create).not.toHaveBeenCalled();
  });
});
