import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-box";

describe("secret-box", () => {
  const S = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  it("암호화 후 복호화하면 원문, 암호문에는 원문이 없다", () => {
    const box = encryptSecret("sk-live-ABCDEF123456", S);
    expect(box.startsWith("v1.")).toBe(true);
    expect(box).not.toContain("ABCDEF");
    expect(decryptSecret(box, S)).toBe("sk-live-ABCDEF123456");
  });
  it("같은 값도 매번 다른 암호문(IV가 달라짐)", () => {
    expect(encryptSecret("x", S)).not.toBe(encryptSecret("x", S));
  });
  it("★ 다른 시크릿으로는 복호화되지 않는다(null)", () => {
    expect(decryptSecret(encryptSecret("key", S), "another-secret-bbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();
  });
  it("★ 암호문을 한 글자라도 바꾸면 거부(GCM 변조 감지)", () => {
    const box = encryptSecret("key-value", S);
    const parts = box.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 1;
    expect(decryptSecret([parts[0], parts[1], parts[2], data.toString("base64")].join("."), S)).toBeNull();
  });
  it("형식이 틀리거나 시크릿이 없으면 null / 암호화는 시크릿 필수", () => {
    expect(decryptSecret("garbage", S)).toBeNull();
    expect(decryptSecret("v2.a.b.c", S)).toBeNull();
    expect(decryptSecret(encryptSecret("k", S), undefined)).toBeNull();
    expect(() => encryptSecret("k", undefined)).toThrow();
  });
  it("한글 등 비ASCII도 왕복", () => {
    expect(decryptSecret(encryptSecret("키-한글-🔑", S), S)).toBe("키-한글-🔑");
  });
});
