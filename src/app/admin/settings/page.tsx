import { LlmSettingsForm } from "@/components/admin/LlmSettingsForm";
import { maskKey, mergePricing } from "@/lib/llm-settings";
import { pricing as basePricing } from "@/lib/pricing";
import { resolveRuntime } from "@/lib/llm/runtime";
import { loadLlmSettingsFresh } from "@/lib/settings-db";

const SOURCE_LABEL = { db: "이 화면에서 저장한 설정", env: "환경변수(.env)", mock: "키 없음 → 가짜 응답(mock)" } as const;

export default async function SettingsPage() {
  const { settings, keyUnreadable } = await loadLlmSettingsFresh();
  const rt = await resolveRuntime();
  const table = mergePricing(basePricing, settings?.pricing);

  const chatModel = settings?.chatModel ?? process.env.LLM_CHAT_MODEL?.trim() ?? "";
  const classifierModel = settings ? settings.classifierModel : process.env.LLM_CLASSIFIER_MODEL?.trim() ?? "";
  const p = (m: string) => table.models[m] ?? table.default;

  return (
    <section className="sec">
      <h1 className="h1">LLM 설정</h1>
      <p className="note-s">
        여기서 API 키·모델·단가를 넣으면 <strong>재시작 없이 바로</strong>(저장 직후 다음 요청부터) 대화, 안전 분류기, 요약에 적용됩니다. 화면 설정이 환경변수보다 우선합니다.
      </p>

      <div className="stats three">
        <div className="stat"><span>현재 사용 중인 설정</span><b className="txt">{SOURCE_LABEL[rt.source]}</b></div>
        <div className="stat"><span>어댑터</span><b className="txt">{rt.llm.adapter.name}</b></div>
        <div className="stat"><span>대화 / 분류기·요약 모델</span><b className="txt">{rt.llm.chatModel} / {rt.llm.lightModel}</b></div>
      </div>

      {rt.source === "mock" && <p className="warn">지금은 가짜 응답(mock)입니다. 아래에 키를 넣고 저장하면 실제 모델로 바뀝니다.</p>}
      {keyUnreadable && <p className="error">저장된 키를 읽을 수 없습니다(AUTH_SECRET이 바뀌었을 수 있음). 키를 다시 입력해 저장해 주세요.</p>}

      <LlmSettingsForm
        initial={{
          baseUrl: settings?.baseUrl ?? (process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1"),
          chatModel,
          classifierModel,
          structuredOutput: settings ? settings.structuredOutput : process.env.LLM_STRUCTURED_OUTPUT !== "off",
          reasoningEffort: settings ? settings.reasoningEffort : process.env.LLM_REASONING_EFFORT?.trim() ?? "",
          maxOutputTokens: settings ? settings.maxOutputTokens : 0,
          keyHint: maskKey(settings?.apiKey),
          chatPrice: { in: p(chatModel).inputPer1M, cached: p(chatModel).cachedInputPer1M, out: p(chatModel).outputPer1M },
          classifierPrice: { in: p(classifierModel || chatModel).inputPer1M, cached: p(classifierModel || chatModel).cachedInputPer1M, out: p(classifierModel || chatModel).outputPer1M },
        }}
      />

      <h2 className="h2 gap">알아둘 점</h2>
      <ul className="notes">
        <li>키는 <strong>암호화(AES-256-GCM)해서 DB에 저장</strong>하고, 이 화면에 다시 보여 주지 않습니다(끝 4자리만 표시). 암호화 키는 <code>AUTH_SECRET</code>에서 만들어지므로 <code>AUTH_SECRET</code>을 바꾸면 저장된 키는 읽을 수 없게 됩니다.</li>
        <li>DB와 <code>AUTH_SECRET</code>이 함께 유출되면 키도 유출됩니다. <strong>공개 운영에서는 환경변수로 주입하는 쪽이 더 안전</strong>하고, 이 화면은 개발·데모에서 바로 써 보기 위한 용도입니다.</li>
        <li>키를 넣으면 <strong>실제 호출 비용이 발생</strong>합니다. 사용자별 일일 한도(<code>DAILY_MESSAGE_LIMIT</code>)가 비용 방어선이고, 제공사 쪽 월 한도도 함께 설정해 두세요.</li>
        <li>안전 분류기가 판정 JSON을 올바른 형식으로 돌려주지 못하면(또는 호출이 실패하면) 안전 검사는 <strong>모든 입력을 차단</strong>합니다(fail closed). 저장 전에 <strong>연결 테스트</strong>로 확인하세요.</li>
        <li>주소는 https만 허용합니다(로컬 테스트용 <code>http://localhost</code> 제외). 제공사가 OpenAI 호환 <code>/chat/completions</code> 스트리밍을 지원해야 합니다.</li>
      </ul>
    </section>
  );
}
