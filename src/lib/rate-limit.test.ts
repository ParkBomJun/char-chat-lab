import { describe, expect, it } from "vitest";
import { LOGIN_POLICY, SIGNUP_POLICY, clientIp, limited, normalizeEmailKey, retryAfterSeconds } from "./rate-limit";

const h = (xff?: string) => ({ get: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? (xff ?? null) : null) });

describe("clientIp", () => {
  it("헤더가 없으면 unknown", () => expect(clientIp(h())).toBe("unknown"));
  it("프록시 한 단계: 오른쪽 끝 값(프록시가 본 주소)을 쓴다", () => {
    expect(clientIp(h("203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(h("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
  });
  it("★ 클라이언트가 앞에 가짜 값을 넣어도 무시된다(맨 앞 값을 믿으면 우회됨)", () => {
    expect(clientIp(h("6.6.6.6, 7.7.7.7, 203.0.113.9"))).toBe("203.0.113.9");
  });
  it("hops=2면 오른쪽에서 두 번째(프록시가 두 단계일 때)", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });
  it("hops가 목록보다 크면 맨 앞 값, 공백 항목 무시", () => {
    expect(clientIp(h("203.0.113.9"), 3)).toBe("203.0.113.9");
    expect(clientIp(h(" , 203.0.113.9 ,"))).toBe("203.0.113.9");
  });
});

describe("한도 판정", () => {
  it("max에 도달하면 제한(5번째 실패 다음 시도부터 막힘)", () => {
    expect(limited(4, LOGIN_POLICY.perEmailIp)).toBe(false);
    expect(limited(5, LOGIN_POLICY.perEmailIp)).toBe(true);
    expect(limited(19, LOGIN_POLICY.perIp)).toBe(false);
    expect(limited(20, LOGIN_POLICY.perIp)).toBe(true);
    expect(limited(10, SIGNUP_POLICY.perIp)).toBe(true);
  });
  it("이메일 키는 대소문자·공백을 정규화하고 길이를 제한", () => {
    expect(normalizeEmailKey("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(normalizeEmailKey("a".repeat(500)).length).toBe(254);
  });
  it("재시도까지 남은 시간", () => {
    const now = new Date("2026-11-11T00:10:00Z");
    expect(retryAfterSeconds(new Date("2026-11-11T00:00:00Z"), LOGIN_POLICY.perEmailIp, now)).toBe(5 * 60);
    expect(retryAfterSeconds(null, LOGIN_POLICY.perEmailIp, now)).toBe(0);
    expect(retryAfterSeconds(new Date("2026-11-10T00:00:00Z"), LOGIN_POLICY.perEmailIp, now)).toBe(0);
  });
});
