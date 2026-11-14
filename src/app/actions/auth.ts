"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/auth";
import { SIGNUP_CLOSED_MESSAGE, signupEnabled } from "@/lib/demo-mode";
import { requestIp, signupThrottled } from "@/lib/rate-limit-db";

export type FormState = { error?: string; email?: string } | undefined;

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("올바른 이메일을 입력해 주세요."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(72, "비밀번호는 72자 이하여야 합니다."),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      if ((e as { code?: string }).code === "too_many_attempts") {
        return { error: "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.", email };
      }
      return { error: "이메일 또는 비밀번호가 올바르지 않습니다.", email };
    }
    throw e; // signIn 성공 시의 redirect 포함
  }
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // 가입 차단(SIGNUP_ENABLED=false)의 기준은 여기다. 화면에서 폼을 숨겨도 액션은 직접 호출할 수 있다.
  if (!signupEnabled()) return { error: SIGNUP_CLOSED_MESSAGE };

  const rawEmail = String(formData.get("email") ?? "");
  const parsed = signupSchema.safeParse({
    email: rawEmail,
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: rawEmail };

  const { email, password } = parsed.data;
  if (await signupThrottled(requestIp(await headers()))) {
    return { error: "가입 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.", email };
  }
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) return { error: "이미 가입된 이메일입니다.", email };

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.user.create({ data: { email, passwordHash } });
  } catch {
    return { error: "가입 중 오류가 발생했습니다. 다시 시도해 주세요.", email }; // 동시 가입으로 인한 unique 충돌 등
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
