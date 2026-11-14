import Link from "next/link";
import { AuthForm, AuthShell } from "@/components/AuthForm";
import { getAuthPreview } from "@/lib/auth-preview";
import { SIGNUP_CLOSED_MESSAGE, signupEnabled } from "@/lib/demo-mode";
import { signupAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const preview = await getAuthPreview();
  // 가입이 닫혀 있으면 폼을 내보내지 않는다. 실제 차단은 signupAction이 한다.
  if (!signupEnabled()) {
    return (
      <AuthShell preview={preview}>
        <div className="form">
          <h1>회원가입</h1>
          <p className="banner lim" role="status">{SIGNUP_CLOSED_MESSAGE}</p>
          <p><Link href="/login">로그인으로 가기</Link></p>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthForm
      title="회원가입"
      submitLabel="가입하기"
      action={signupAction}
      alt={{ href: "/login", label: "이미 계정이 있나요? 로그인" }}
      passwordAutoComplete="new-password"
      preview={preview}
    />
  );
}
