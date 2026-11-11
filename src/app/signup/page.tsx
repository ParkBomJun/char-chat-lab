import { AuthForm } from "@/components/AuthForm";
import { signupAction } from "@/app/actions/auth";

export default function SignupPage() {
  return (
    <AuthForm
      title="회원가입"
      submitLabel="가입하기"
      action={signupAction}
      alt={{ href: "/login", label: "이미 계정이 있나요? 로그인" }}
      passwordAutoComplete="new-password"
    />
  );
}
