import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure, requestIp } from "@/lib/rate-limit-db";

/** 시도 한도 초과. code로 화면에서 일반 실패와 구분한다. */
export class TooManyAttempts extends CredentialsSignin {
  code = "too_many_attempts";
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const ip = requestIp(request.headers);

        // 비밀번호를 검사하기 전에 한도부터 본다(추측 속도 제한)
        if (await isLoginThrottled(email, ip)) throw new TooManyAttempts();

        const user = await prisma.user.findUnique({ where: { email } });
        // 존재하지 않는 계정도 같은 방식으로 실패를 센다
        const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
        if (!user || !ok) {
          await recordLoginFailure(email, ip);
          return null;
        }
        await clearLoginFailures(email, ip);
        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      session.user.role = (token.role as "USER" | "ADMIN" | undefined) ?? "USER";
      return session;
    },
  },
});
