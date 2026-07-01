import { Suspense } from "react";
import { SsoClient } from "./SsoClient";

export const dynamic = "force-dynamic";

// 埋め込み用SSOエントリ（AI Companyの「SEO対策」iframeから遷移）。
// ?token と ?redirect を受け取り、同一オリジンfetchでセッションを確立して遷移する。
// クロスサイトのリダイレクトでCookieを立てるとiframe内で弾かれやすいため、
// x-step と同様「ページを開いてから同一オリジンfetchでCookieを立てる」方式にする。
export default function SsoPage() {
  return (
    <Suspense fallback={null}>
      <SsoClient />
    </Suspense>
  );
}
