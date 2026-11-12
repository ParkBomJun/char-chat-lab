import Link from "next/link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "관리자" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="admin">
      <header className="top admin-top">
        <div className="wrap">
          <Link href="/" className="brand">정원 도서관<small>관리자</small></Link>
          <AdminTabs />
          <span className="small">{admin.email}</span>
        </div>
      </header>
      <main className="wrap admin-main">{children}</main>
    </div>
  );
}
