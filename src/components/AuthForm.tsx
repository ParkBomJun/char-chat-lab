"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";

type Props = {
  title: string;
  submitLabel: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  alt: { href: string; label: string };
  passwordAutoComplete: "current-password" | "new-password";
  /** 왼쪽 면에 보여 줄 캐릭터의 첫 인사(공개 정보). 없으면 생략 */
  preview: { name: string; greeting: string } | null;
};

export function AuthForm({ title, submitLabel, action, alt, passwordAutoComplete, preview }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <div className="login">
      <div className="login-side">
        <span className="brand">정원 도서관</span>
        <div className="login-copy">
          <h2>AI 캐릭터와 나누는<br />조용한 대화</h2>
          {preview && (
            <div className="login-prev">
              <span>{preview.name}</span>
              <p>{preview.greeting}</p>
            </div>
          )}
        </div>
        <span className="tiny">전 연령 서비스 · 개인 개발 프로젝트 char-chat-lab</span>
      </div>
      <main className="login-main">
        <form className="form" action={formAction}>
          <h1>{title}</h1>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email ?? ""} required />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input id="password" name="password" type="password" autoComplete={passwordAutoComplete} required minLength={8} />
          </div>
          {state?.error && <p role="alert" className="banner err">{state.error}</p>}
          <button type="submit" className="btn" disabled={pending}>{pending ? "처리 중…" : submitLabel}</button>
          <p><Link href={alt.href}>{alt.label}</Link></p>
          <p className="tiny">
            AI와의 대화입니다. 민감한 개인정보는 입력하지 마세요. <Link href="/privacy">데모 서비스 안내</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
