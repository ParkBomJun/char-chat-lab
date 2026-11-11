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
};

export function AuthForm({ title, submitLabel, action, alt, passwordAutoComplete }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <main className="auth-card">
      <h1>{title}</h1>
      <form action={formAction}>
        <label>
          이메일
          <input name="email" type="email" autoComplete="email" defaultValue={state?.email ?? ""} required />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" autoComplete={passwordAutoComplete} required minLength={8} />
        </label>
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        <button type="submit" disabled={pending}>{pending ? "처리 중…" : submitLabel}</button>
      </form>
      <p><Link href={alt.href}>{alt.label}</Link></p>
    </main>
  );
}
