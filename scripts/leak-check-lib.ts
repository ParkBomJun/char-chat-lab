/**
 * 일반 사용자 응답에 캐릭터 비공개 필드가 섞였는지 찾는 순수 함수들(E2E 스크립트와 단위 테스트가 공유).
 * 비공개 필드의 문장 지문(앞부분·중간 10글자, 공백 제거)이 응답 텍스트에 나오면 누출로 본다.
 */
export type Secret = { label: string; text: string };

const MIN = 10;

/** 응답 본문을 비교용으로 정규화: JSON/RSC 유니코드 이스케이프 복원, HTML 엔티티 일부 복원, 공백 제거. */
export function normalizeForScan(raw: string): string {
  let t = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" })[e] ?? "");
  t = t.replace(/\\n/g, "\n");
  return t.replace(/\s+/g, "");
}

export function fingerprints(text: string): string[] {
  const out = new Set<string>();
  for (const s of text.split(/\n|[.!?。]|(?<=다)\s|(?<=요)\s/)) {
    const c = s.replace(/\s+/g, "");
    if (c.length < MIN) continue;
    out.add(c.slice(0, MIN));
    const mid = Math.floor(c.length / 2);
    out.add(c.slice(mid, mid + MIN));
  }
  return [...out];
}

/**
 * 비공개 필드별 지문. 공개해도 되는 텍스트(이름·소개·인사말 등)에 이미 있는 지문은 뺀다
 * (인사말이 persona 문장과 겹쳐도 거짓 양성이 나오지 않게).
 */
export function buildFingerprints(secrets: readonly Secret[], allowedPublicText: string): { label: string; prints: string[] }[] {
  const allowed = normalizeForScan(allowedPublicText);
  return secrets.map((s) => ({ label: s.label, prints: fingerprints(s.text).filter((p) => !allowed.includes(p)) })).filter((f) => f.prints.length > 0);
}

export type Scan = { name: string; bytes: number; hits: string[] };

export function scanResponse(name: string, raw: string, prints: readonly { label: string; prints: string[] }[]): Scan {
  const text = normalizeForScan(raw);
  return { name, bytes: raw.length, hits: prints.filter((f) => f.prints.some((p) => text.includes(p))).map((f) => f.label) };
}
