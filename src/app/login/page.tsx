import { AuthForm } from "@/components/AuthForm";
import { getAuthPreview } from "@/lib/auth-preview";
import { DEMO_SHARED_NOTICE, demoNoticeEnabled, signupEnabled } from "@/lib/demo-mode";
import { loginAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const preview = await getAuthPreview();
  return (
    <AuthForm
      title="로그인"
      submitLabel="로그인"
      action={loginAction}
      alt={signupEnabled() ? { href: "/signup", label: "계정이 없나요? 회원가입" } : undefined}
      passwordAutoComplete="current-password"
      preview={preview}
      // 로그인 전이라 계정을 알 수 없다. 데모 계정을 공개한 배포(DEMO_NOTICE=true)에서는 누구에게나 미리 알린다.
      notice={demoNoticeEnabled() ? DEMO_SHARED_NOTICE : undefined}
    />
  );
}
