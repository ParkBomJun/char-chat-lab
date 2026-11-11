"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRESETS } from "@/lib/llm-settings";
import { clearLlmAction, saveLlmAction, testLlmAction, type SaveResult, type TestResult } from "@/app/admin/settings/actions";

export type LlmFormInitial = {
  baseUrl: string;
  chatModel: string;
  classifierModel: string;
  structuredOutput: boolean;
  reasoningEffort: string;
  maxOutputTokens: number;
  /** 저장된 키의 끝 4자리 표시(없으면 null). 키 원문은 클라이언트에 오지 않는다. */
  keyHint: string | null;
  chatPrice: { in: number; cached: number; out: number };
  classifierPrice: { in: number; cached: number; out: number };
};

export function LlmSettingsForm({ initial }: { initial: LlmFormInitial }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [save, setSave] = useState<SaveResult | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  // 폼 액션이 아니라 직접 호출한다: 폼 액션은 끝나면 입력란을 비워 버려 키를 다시 쳐야 한다.
  const run = (kind: "save" | "test" | "clear") =>
    startTransition(async () => {
      setBusy(kind);
      const fd = new FormData(formRef.current!);
      if (kind === "test") {
        setSave(null);
        setTest(null); // 이전 테스트 결과가 남아 새 결과로 오해되지 않게
        setTest(await testLlmAction(fd));
      } else if (kind === "save") {
        setTest(null);
        const r = await saveLlmAction(fd);
        setSave(r);
        if (r.ok) {
          const key = formRef.current?.elements.namedItem("apiKey") as HTMLInputElement | null;
          if (key) key.value = ""; // 저장 후 입력란의 키는 지운다
          router.refresh();
        }
      } else {
        if (!window.confirm("화면에서 저장한 설정(키 포함)을 삭제할까요?")) return;
        setTest(null);
        const r = await clearLlmAction();
        setSave(r);
        if (r.ok) router.refresh();
      }
      setBusy(null);
    });

  const [presetNote, setPresetNote] = useState<string | null>(null);
  const applyPreset = (k: keyof typeof PRESETS) => {
    const f = formRef.current;
    if (!f) return;
    (f.elements.namedItem("baseUrl") as HTMLInputElement).value = PRESETS[k].baseUrl;
    (f.elements.namedItem("structuredOutput") as HTMLInputElement).checked = PRESETS[k].structuredOutput;
    setTest(null);
    setPresetNote(
      k === "openrouter"
        ? "OpenRouter: 모델 이름은 '제공사/모델' 형식입니다(openrouter.ai/models에서 복사). 모델마다 구조화 출력 지원이 달라 기본으로 껐습니다. Gemini 같은 추론(thinking) 모델은 응답이 느리거나 빈 응답이 올 수 있으니 아래 '추론 강도'를 low나 minimal로 두고 연결 테스트를 해 보세요."
        : "OpenAI 주소로 채웠습니다.",
    );
  };

  const num = (name: string, v: number) => (
    <input name={name} type="number" step="any" min={0} defaultValue={v} />
  );

  return (
    <form ref={formRef} className="admin-form" onSubmit={(e) => { e.preventDefault(); run("save"); }} autoComplete="off">
      <div className="inline">
        <span className="who">프리셋(주소만 채움):</span>
        <button type="button" className="ghost" onClick={() => applyPreset("openai")}>OpenAI</button>
        <button type="button" className="ghost" onClick={() => applyPreset("openrouter")}>OpenRouter</button>
      </div>
      {presetNote && <p className="who">{presetNote}</p>}
      <label>
        API 주소 (OpenAI 호환, /v1 까지)
        <input name="baseUrl" defaultValue={initial.baseUrl} required placeholder="https://api.openai.com/v1" />
      </label>
      <label>
        API 키 {initial.keyHint ? <span className="who">(저장된 키: {initial.keyHint} — 비워 두면 유지)</span> : <span className="who">(저장된 키 없음)</span>}
        <input name="apiKey" type="password" autoComplete="new-password" placeholder={initial.keyHint ? "바꾸려면 새 키를 붙여넣기" : "키를 붙여넣기"} />
      </label>
      <label>
        대화 모델
        <input name="chatModel" defaultValue={initial.chatModel} required placeholder="예: 제공사/모델이름 (OpenRouter) 또는 모델 이름" />
      </label>
      <label>
        분류기·요약 모델 <span className="who">(안전 검사와 요약에 쓰는 저가 모델. 비우면 대화 모델)</span>
        <input name="classifierModel" defaultValue={initial.classifierModel} placeholder="비워도 됨" />
      </label>
      <label className="check">
        <input type="checkbox" name="structuredOutput" defaultChecked={initial.structuredOutput} />
        분류기에 구조화 출력(json_schema) 사용 — 제공사가 지원하지 않으면 끄세요
      </label>

      <div className="inline">
        <label>
          추론(reasoning) 강도 <span className="who">(추론 모델이 느리거나 빈 응답을 줄 때 낮추세요)</span>
          <select name="reasoningEffort" defaultValue={initial.reasoningEffort}>
            <option value="">모델 기본값(보내지 않음)</option>
            <option value="none">none — 끄기(끌 수 없는 모델은 오류)</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          최대 출력 토큰 <span className="who">(0 = 서버 기본값. 추론 토큰도 여기서 소모됨)</span>
          <input name="maxOutputTokens" type="number" min={0} step={1} defaultValue={initial.maxOutputTokens} />
        </label>
      </div>
      <p className="who">추론 강도는 OpenRouter의 <code>reasoning.effort</code> 규약으로 전송됩니다. 다른 제공사가 이 필드를 거부하면 &quot;모델 기본값&quot;으로 두세요.</p>

      <fieldset className="price-set">
        <legend>단가 (USD / 100만 토큰) — 비용 계산용, 모르면 0</legend>
        <div className="price-grid">
          <span />
          <span className="who">입력</span><span className="who">캐시 입력</span><span className="who">출력</span>
          <span>대화 모델</span>{num("chatIn", initial.chatPrice.in)}{num("chatCached", initial.chatPrice.cached)}{num("chatOut", initial.chatPrice.out)}
          <span>분류기 모델</span>{num("clsIn", initial.classifierPrice.in)}{num("clsCached", initial.classifierPrice.cached)}{num("clsOut", initial.classifierPrice.out)}
        </div>
      </fieldset>

      <div className="inline">
        <button type="button" disabled={pending} onClick={() => run("test")}>{busy === "test" ? "테스트 중…" : "연결 테스트"}</button>
        <button type="submit" disabled={pending}>{busy === "save" ? "저장 중…" : "저장"}</button>
        <button type="button" className="danger" disabled={pending} onClick={() => run("clear")}>저장된 설정 삭제</button>
      </div>

      {save && <p className={save.ok ? "ok" : "error"}>{save.ok ? save.message : save.error}</p>}
      {test && !test.ok && <p className="error">{test.error}</p>}
      {test && test.ok && (
        <div className="test-box">
          {test.checks.map((c) => (
            <p key={c.name} className={c.ok ? "ok" : "error"}>
              {c.ok ? "✓" : "✗"} {c.name} · {c.ms}ms<br />
              <span className="who">{c.detail}</span>
            </p>
          ))}
          {test.hint && <p><strong>힌트:</strong> {test.hint}</p>}
          {test.checks.every((c) => c.ok) && <p className="ok">두 검사가 모두 통과했습니다. 저장하면 바로 적용됩니다.</p>}
        </div>
      )}
    </form>
  );
}
