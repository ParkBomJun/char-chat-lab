"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "요약" },
  { href: "/admin/moderation", label: "판정 로그" },
  { href: "/admin/characters", label: "캐릭터" },
  { href: "/admin/settings", label: "LLM 설정" },
];

/** 관리자 탭. 현재 탭은 aria-current로 표시한다(굵은 글과 아래 선). */
export function AdminTabs() {
  const path = usePathname();
  const isCurrent = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <nav className="tabs" aria-label="관리자 메뉴">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={isCurrent(t.href) ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
