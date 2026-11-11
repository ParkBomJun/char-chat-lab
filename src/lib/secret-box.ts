import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * 작은 비밀값(API 키)을 DB에 넣기 위한 암호화. AES-256-GCM(변조 감지 포함).
 * 암호화 키는 AUTH_SECRET에서 유도한다 → AUTH_SECRET을 바꾸면 저장된 키는 복호화되지 않고 "미설정"으로 취급되며, 다시 입력하면 된다.
 * 한계: DB와 AUTH_SECRET이 함께 유출되면 키도 유출된다. 운영에서는 환경변수로 주입하는 쪽이 더 안전하다.
 */
const deriveKey = (secret: string) => createHash("sha256").update(`char-chat-lab:secret-box:v1:${secret}`).digest();

export function encryptSecret(plain: string, secret: string | undefined): string {
  if (!secret) throw new Error("AUTH_SECRET이 없어 비밀값을 암호화할 수 없습니다.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

/** 복호화 실패(다른 시크릿·변조·형식 오류)는 예외가 아니라 null. */
export function decryptSecret(box: string, secret: string | undefined): string | null {
  if (!secret) return null;
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
