"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearLlmAction, saveLlmAction, testLlmAction, type SaveResult, type TestResult } from "@/app/admin/settings/actions";

export type LlmFormInitial = {
  baseUrl: string;
  chatModel: string;
  classifierModel: string;
  structuredOutput: boolean;
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

  const num = (name: string, v: number) => (
    <input name={name} type="number" step="any" min={0} defaultValue={v} />
  );

  return (
    <form ref={formRef} className="admin-form" onSubmit={(e) => { e.preventDefault(); run("save"); }} autoComplete="off">
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
        <input name="chatModel" defaultValue={initial.chatModel} required placeholder="제공사의 모델 이름" />
      </label>
      <label>
        분류기·요약 모델 <span className="who">(안전 검사와 요약에 쓰는 저가 모델. 비우면 대화 모델)</span>
        <input name="classifierModel" defaultValue={initial.classifierModel} placeholder="비워도 됨" />
      </label>
      <label className="check">
        <input type="checkbox" name="structuredOutput" defaultChecked={initial.structuredOutput} />
        분류기에 구조화 출력(json_schema) 사용 — 제공사가 지원하지 않으면 끄세요
      </label>

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
