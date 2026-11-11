import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "char-chat-lab",
  description: "AI 캐릭터와 대화하는 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
