"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/app/actions/auth";

type Props = {
  title: string;
  submitLabel: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** 반대쪽 화면으로 가는 링크. 없으면 숨긴다(가입이 닫혀 있을 때의 로그인 화면) */
  alt?: { href: string; label: string };
  passwordAutoComplete: "current-password" | "new-password";
  /** 왼쪽 면에 보여 줄 캐릭터의 첫 인사(공개 정보). 없으면 생략 */
  preview: { name: string; greeting: string } | null;
  /** 폼 위에 보여 줄 안내 한 줄(공용 데모 계정 안내). 없으면 생략 */
  notice?: string;
};

type SideProps = Pick<Props, "preview"> & { children: ReactNode };

/** 로그인·회원가입 화면의 공통 틀(왼쪽 소개 면 + 오른쪽 내용) */
export function AuthShell({ preview, children }: SideProps) {
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
      <main className="login-main">{children}</main>
    </div>
  );
}

export function AuthForm({ title, submitLabel, action, alt, passwordAutoComplete, preview, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <AuthShell preview={preview}>
      <form className="form" action={formAction}>
        <h1>{title}</h1>
        {notice && <p className="banner lim" role="note">{notice}</p>}
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
        {alt && <p><Link href={alt.href}>{alt.label}</Link></p>}
        <p className="tiny">
          AI와의 대화입니다. 민감한 개인정보는 입력하지 마세요. <Link href="/privacy">데모 서비스 안내</Link>
        </p>
      </form>
    </AuthShell>
  );
}
