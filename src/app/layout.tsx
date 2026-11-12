import type { Metadata } from "next";
// 글꼴은 패키지에서 직접 제공한다(외부 CDN 요청 없음). 가변 글꼴의 dynamic subset.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "정원 도서관", template: "%s · 정원 도서관" },
  description: "AI 캐릭터와 대화하는 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
