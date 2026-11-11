import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <>
      <header className="site-header">
        <Link href="/">← 서비스로</Link>
        <nav className="admin-nav">
          <Link href="/admin">요약</Link>
          <Link href="/admin/moderation">판정 로그</Link>
          <Link href="/admin/characters">캐릭터</Link>
          <Link href="/admin/settings">LLM 설정</Link>
        </nav>
        <span className="who">관리자 {admin.email}</span>
      </header>
      <main className="page wide">{children}</main>
    </>
  );
}
