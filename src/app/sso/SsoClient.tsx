"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ?token を同一オリジンの /api/sso/consume に渡してセッションCookieを確立 →
// ?redirect（既定 "/"）へ遷移。fetchのSet-Cookie（Partitioned）はiframe内でも
// 同一オリジン応答として保存されるため、埋め込みでも自動ログインが成立する。
export function SsoClient() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params?.get("token");
    const redirect = params?.get("redirect") || "/";
    if (!token) {
      setError("トークンがありません");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/sso/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, redirect }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; redirect?: string };
        if (!res.ok || !data.ok) {
          setError("自動ログインに失敗しました。リンクの有効期限切れの可能性があります。");
        } else {
          // 成功 → アプリへ（同一iframe内で遷移）
          window.location.replace(data.redirect || redirect);
        }
      } catch {
        setError("接続に失敗しました。");
      }
    })();
  }, [params]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-black text-gray-300">
      {error ? (
        <>
          <p className="text-red-400 text-sm">{error}</p>
          <a href="/login" className="text-emerald-400 text-sm underline">ログイン画面へ</a>
        </>
      ) : (
        <>
          <div className="w-6 h-6 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
          <p className="text-sm">接続中…</p>
        </>
      )}
    </div>
  );
}
