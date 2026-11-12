import { AuthForm } from "@/components/AuthForm";
import { getAuthPreview } from "@/lib/auth-preview";
import { signupAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const preview = await getAuthPreview();
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
