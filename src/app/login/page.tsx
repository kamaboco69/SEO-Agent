"use client";

import { Suspense, useMemo, useState } from "react";
import { LockKeyhole, Search, Loader2, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const urlError = searchParams.get("error");
  const oauthCallback = useMemo(() => encodeURIComponent(callbackUrl), [callbackUrl]);

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? (mode === "login" ? "ログインに失敗しました" : "登録に失敗しました"));
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-[980px] grid grid-cols-[1fr_420px] gap-8 items-center">
        <div className="pr-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{
              background: "linear-gradient(135deg, rgba(56,189,248,0.3), rgba(167,139,250,0.3))",
              border: "1px solid rgba(56,189,248,0.5)",
              boxShadow: "0 0 18px rgba(56,189,248,0.25)",
            }}>
              <Search size={18} style={{ color: "var(--blue)" }} />
            </div>
            <div>
              <p className="text-xl font-bold grad-text">SEO Agent</p>
              <p className="text-[10px] tracking-widest" style={{ color: "var(--text-muted)" }}>AICOMPANY CONNECTED SEO PLATFORM</p>
            </div>
          </div>
          <h1 className="text-3xl font-bold leading-tight mb-4" style={{ color: "var(--text)" }}>
            AICompanyと同じアカウントで<br />SEO運用を接続
          </h1>
          <p className="text-sm leading-7 max-w-xl" style={{ color: "var(--text-muted)" }}>
            Google・GitHub・メールアドレスでログインできます。同じメールアドレスのAICompanyアカウントを
            自動で照合し、登録済みのメディアやアナリスト設定を連携画面の初期値として取り込みます。
          </p>
        </div>

        <div className="glass-static rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <LockKeyhole size={15} style={{ color: "var(--cyan)" }} />
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{mode === "login" ? "ログイン" : "新規登録"}</p>
          </div>

          {urlError && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#f87171" }}>
              {decodeURIComponent(urlError)}
            </div>
          )}

          <div className="space-y-2">
            <a href={`/api/auth/oauth/google?callbackUrl=${oauthCallback}`} className="cyber-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold">
              <GoogleIcon />
              Googleで{mode === "login" ? "ログイン" : "登録"}
            </a>
            <a href={`/api/auth/oauth/github?callbackUrl=${oauthCallback}`} className="cyber-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold">
              <GitHubIcon />
              GitHubで{mode === "login" ? "ログイン" : "登録"}
            </a>
          </div>

          <div className="my-4 flex items-center gap-2">
            <div className="flex-1 h-px" style={{ background: "rgba(56,189,248,0.12)" }} />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>または メールアドレス</span>
            <div className="flex-1 h-px" style={{ background: "rgba(56,189,248,0.12)" }} />
          </div>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", color: "#f87171" }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-2.5">
            {mode === "signup" && (
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="お名前（任意）" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            )}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" autoComplete="email" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "パスワード（8文字以上）" : "パスワード"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <button type="submit" disabled={loading || !email.trim() || !password} className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-40">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
              {mode === "login" ? "メールでログイン" : "メールで新規登録"}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
            {mode === "login" ? "アカウントをお持ちでない方は" : "すでにアカウントをお持ちの方は"}
            <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} className="ml-1 font-bold" style={{ color: "var(--cyan)" }}>
              {mode === "login" ? "新規登録" : "ログイン"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ background: "var(--bg)", minHeight: "100vh" }} />}>
      <LoginContent />
    </Suspense>
  );
}
