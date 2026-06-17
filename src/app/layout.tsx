import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "SEO Agent — Holographic SEO Platform",
  description: "次世代AIシステムによるSEO分析・コンテンツ最適化プラットフォーム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full flex overflow-hidden">
        <Sidebar />
        <main className="main-scroll flex-1 min-w-0">
          {children}
        </main>
      </body>
    </html>
  );
}
