"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Search, BarChart2, FileEdit,
  Link2, TrendingUp, Gauge, FolderOpen, Send, Newspaper,
  LogOut, UserCircle, KeyRound, Loader2, X, ChevronDown,
} from "lucide-react";

const nav = [
  { href: "/",          label: "ダッシュボード",       icon: LayoutDashboard, color: "var(--blue)" },
  { href: "/keywords",  label: "キーワードリサーチ",   icon: Search,          color: "var(--cyan)" },
  { href: "/serp",      label: "SERP分析",             icon: BarChart2,       color: "var(--purple)" },
  { href: "/editor",    label: "コンテンツエディタ",   icon: FileEdit,        color: "#34d399" },
  { href: "/backlinks", label: "被リンク分析",         icon: Link2,           color: "#fb923c" },
  { href: "/tracker",   label: "順位トラッカー",       icon: TrendingUp,      color: "var(--blue)" },
  { href: "/audit",     label: "サイト監査",           icon: Gauge,           color: "#f472b6" },
  { href: "/media",     label: "メディア運用",         icon: Newspaper,       color: "var(--cyan)" },
  { href: "/analyst",   label: "アナリスト連携",       icon: Send,            color: "#34d399" },
  { href: "/projects",  label: "プロジェクト",         icon: FolderOpen,      color: "var(--purple)" },
];

const DISMISS_KEY = "aicompany_connect_dismissed";

function AiCompanyConnectBanner({ callbackUrl }: { callbackUrl: string }) {
  const [open, setOpen] = useState(false);
  const [aiId, setAiId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const idRef = useRef<HTMLInputElement>(null);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    // Trigger re-render in parent by dispatching storage event
    window.dispatchEvent(new Event("storage"));
  }

  useEffect(() => {
    if (open) idRef.current?.focus();
  }, [open]);

  async function connectWithId(e: React.FormEvent) {
    e.preventDefault();
    if (!aiId.trim() || !code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/connect/aicompany-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiCompanyId: aiId.trim(), verificationCode: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "接続に失敗しました");
        return;
      }
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="mx-2 mb-2 rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(52,211,153,0.3)", background: "rgba(52,211,153,0.05)" }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: "#34d399", boxShadow: "0 0 6px #34d399", animation: "pulse-glow 2s ease-in-out infinite" }}
        />
        <p className="text-[10px] font-bold flex-1 leading-tight" style={{ color: "#34d399" }}>
          AICompanyと接続
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
          style={{ color: open ? "#34d399" : "rgba(52,211,153,0.6)" }}
          title={open ? "閉じる" : "接続する"}
        >
          <ChevronDown
            size={12}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
          />
        </button>
        <button onClick={dismiss} style={{ color: "rgba(52,211,153,0.4)" }} title="閉じる">
          <X size={11} />
        </button>
      </div>

      {/* Expanded panel */}
      {open && (
        <div
          className="px-3 pb-3 space-y-2"
          style={{ borderTop: "1px solid rgba(52,211,153,0.12)" }}
        >
          <p className="text-[9px] pt-2 leading-relaxed" style={{ color: "rgba(52,211,153,0.65)" }}>
            同じアカウントでAICompanyの設定を自動反映できます
          </p>

          {/* OAuth button */}
          <a
            href={`/api/auth/oauth/aicompany?mode=connect&callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-all"
            style={{
              background: "rgba(52,211,153,0.12)",
              border: "1px solid rgba(52,211,153,0.3)",
              color: "#34d399",
            }}
          >
            <KeyRound size={11} />
            AICompany OAuthで接続
          </a>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px" style={{ background: "rgba(52,211,153,0.12)" }} />
            <span className="text-[9px]" style={{ color: "rgba(52,211,153,0.4)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "rgba(52,211,153,0.12)" }} />
          </div>

          <form onSubmit={connectWithId} className="space-y-1.5">
            <input
              ref={idRef}
              value={aiId}
              onChange={(e) => setAiId(e.target.value)}
              placeholder="AICompany ID"
              className="cyber-input w-full px-2 py-1.5 rounded-lg text-[10px]"
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="検証コード"
              className="cyber-input w-full px-2 py-1.5 rounded-lg text-[10px]"
            />
            {error && (
              <p className="text-[9px]" style={{ color: "#f87171" }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !aiId.trim() || !code.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40 transition-all"
              style={{
                background: "rgba(52,211,153,0.12)",
                border: "1px solid rgba(52,211,153,0.3)",
                color: "#34d399",
              }}
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <KeyRound size={10} />}
              IDで接続
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? "";
  const [user, setUser] = useState<{ email: string; name: string | null; providers: string[] } | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  function fetchUser() {
    if (pathname.startsWith("/login")) return;
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        const u = data?.user ?? null;
        setUser(u);
        if (u && !u.providers.includes("aicompany")) {
          const dismissed = localStorage.getItem(DISMISS_KEY);
          setShowConnect(!dismissed);
        } else {
          setShowConnect(false);
        }
      })
      .catch(() => setUser(null));
  }

  useEffect(() => {
    fetchUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Re-check when dismissed via storage event
  useEffect(() => {
    const handler = () => {
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (dismissed) setShowConnect(false);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  if (pathname.startsWith("/login")) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col shrink-0"
        style={{
          width: "200px",
          background: "rgba(4, 10, 30, 0.9)",
          borderRight: "1px solid rgba(56,189,248,0.15)",
          backdropFilter: "blur(24px)",
          height: "100vh",
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 px-4 py-4"
          style={{ borderBottom: "1px solid rgba(56,189,248,0.12)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(56,189,248,0.3), rgba(167,139,250,0.3))",
              border: "1px solid rgba(56,189,248,0.5)",
              boxShadow: "0 0 12px rgba(56,189,248,0.3)",
            }}
          >
            <Search size={15} style={{ color: "var(--blue)" }} />
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color: "var(--blue)", textShadow: "0 0 8px rgba(56,189,248,0.6)" }}>
              SEO Agent
            </p>
            <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>HOLOGRAPHIC PLATFORM</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon, color }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 group"
                style={
                  active
                    ? {
                        background: `rgba(56,189,248,0.1)`,
                        border: `1px solid rgba(56,189,248,0.25)`,
                        color: "var(--blue)",
                        boxShadow: "0 0 12px rgba(56,189,248,0.1)",
                      }
                    : {
                        border: "1px solid transparent",
                        color: "var(--text-muted)",
                      }
                }
              >
                <Icon
                  size={14}
                  style={{ color: active ? color : "var(--text-muted)", transition: "color 0.2s" }}
                />
                <span className="flex-1">{label}</span>
                {active && (
                  <span
                    className="w-1 h-1 rounded-full pulse-glow"
                    style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* AICompany connect banner */}
        {showConnect && user && (
          <AiCompanyConnectBanner callbackUrl={pathname} />
        )}

        {/* Account */}
        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid rgba(56,189,248,0.08)" }}
        >
          {user ? (
            <div className="flex items-center gap-2">
              <UserCircle size={16} style={{ color: "var(--blue)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold truncate" style={{ color: "var(--text)" }}>{user.name ?? user.email}</p>
                <p className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>{user.providers.join(" / ") || user.email}</p>
              </div>
              <button onClick={logout} className="shrink-0 transition-colors" style={{ color: "var(--text-muted)" }} title="ログアウト">
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <Link href="/login" className="cyber-btn w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold">
              ログイン
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden"
        style={{
          background: "rgba(4,10,30,0.95)",
          borderTop: "1px solid rgba(56,189,248,0.2)",
          backdropFilter: "blur(20px)",
        }}
      >
        {nav.slice(0, 5).map(({ href, label, icon: Icon, color }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[9px] transition-colors"
              style={{ color: active ? color : "var(--text-muted)" }}
            >
              <Icon size={18} />
              <span>{label.slice(0, 4)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
