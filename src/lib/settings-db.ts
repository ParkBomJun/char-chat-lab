import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import type { LlmSettings } from "@/lib/llm-settings";

const KEY = "llm";

const storedSchema = z.object({
  baseUrl: z.string(),
  apiKeyEnc: z.string(),
  chatModel: z.string(),
  classifierModel: z.string(),
  structuredOutput: z.boolean(),
  pricing: z.record(z.string(), z.object({ inputPer1M: z.number(), cachedInputPer1M: z.number(), outputPer1M: z.number() })),
});

export type StoredView = { settings: LlmSettings | null; /** 저장돼 있는데 복호화할 수 없음(AUTH_SECRET이 바뀜 등) */ keyUnreadable: boolean };

async function read(): Promise<StoredView> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return { settings: null, keyUnreadable: false };
  let parsed: z.infer<typeof storedSchema>;
  try {
    parsed = storedSchema.parse(JSON.parse(row.value));
  } catch {
    console.error("[settings] 저장된 LLM 설정 형식이 올바르지 않아 무시합니다.");
    return { settings: null, keyUnreadable: true };
  }
  const apiKey = decryptSecret(parsed.apiKeyEnc, process.env.AUTH_SECRET);
  if (!apiKey) {
    console.error("[settings] 저장된 API 키를 복호화할 수 없어 무시합니다(AUTH_SECRET이 바뀌었을 수 있음). 화면에서 다시 입력하세요.");
    return { settings: null, keyUnreadable: true };
  }
  const { apiKeyEnc: _omit, ...rest } = parsed;
  void _omit;
  return { settings: { ...rest, apiKey }, keyUnreadable: false };
}

/**
 * 채팅 경로용. 캐시하지 않고 요청마다 기본키 한 줄을 읽는다.
 * 프로세스 안 캐시는 서버 액션과 라우트가 서로 다른 번들(모듈 인스턴스)이라 무효화가 전달되지 않고,
 * 서버가 여러 대여도 저장 직후 모든 인스턴스에 반영되려면 DB를 직접 읽는 쪽이 맞다. 읽기에 실패하면 환경변수 설정으로 폴백한다.
 */
export async function loadLlmSettings(): Promise<LlmSettings | null> {
  try {
    return (await read()).settings;
  } catch (e) {
    console.error("[settings] 설정을 읽지 못했습니다(환경변수로 폴백)", e instanceof Error ? e.message : e);
    return null;
  }
}

/** 관리자 화면용(복호화 실패 여부 포함) */
export const loadLlmSettingsFresh = read;

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  const { apiKey, ...rest } = s;
  const value = JSON.stringify({ ...rest, apiKeyEnc: encryptSecret(apiKey, process.env.AUTH_SECRET) });
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}

export async function clearLlmSettings(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
}
