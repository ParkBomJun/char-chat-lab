import { AuthForm } from "@/components/AuthForm";
import { loginAction } from "@/app/actions/auth";

export default function LoginPage() {
  return (
    <AuthForm
      title="로그인"
      submitLabel="로그인"
      action={loginAction}
      alt={{ href: "/signup", label: "계정이 없나요? 회원가입" }}
      passwordAutoComplete="current-password"
    />
  );
}
