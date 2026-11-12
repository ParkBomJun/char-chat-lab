import { AuthForm } from "@/components/AuthForm";
import { getAuthPreview } from "@/lib/auth-preview";
import { loginAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const preview = await getAuthPreview();
  return (
    <AuthForm
      title="로그인"
      submitLabel="로그인"
      action={loginAction}
      alt={{ href: "/signup", label: "계정이 없나요? 회원가입" }}
      passwordAutoComplete="current-password"
      preview={preview}
    />
  );
}
