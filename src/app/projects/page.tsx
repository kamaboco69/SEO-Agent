"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, FolderOpen, Globe, Key, Search } from "lucide-react";

interface Project { id: string; name: string; domain: string | null; description: string | null; createdAt: string; _count: { keywords: number; articles: number }; }

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() { const res = await fetch("/api/projects"); setProjects(await res.json()); setLoading(false); }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), domain: domain.trim() || null }) });
    setName(""); setDomain("");
    await load(); setAdding(false);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 py-4" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.7)" }}>PROJECT MANAGER</p>
        <h1 className="text-lg font-bold" style={{ color: "var(--purple)", textShadow: "0 0 12px rgba(167,139,250,0.5)" }}>プロジェクト</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Add form */}
        <form onSubmit={create} className="glass-static rounded-xl p-4">
          <p className="text-xs font-bold tracking-wider mb-3" style={{ color: "var(--purple)" }}>+ 新規プロジェクト</p>
          <div className="flex gap-2 flex-wrap">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="プロジェクト名（例: コーポレートサイト）"
              className="cyber-input flex-1 min-w-48 px-3 py-2 rounded-lg text-sm" />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="ドメイン（任意）"
              className="cyber-input flex-1 min-w-36 px-3 py-2 rounded-lg text-sm" />
            <button type="submit" disabled={adding || !name.trim()} className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              作成
            </button>
          </div>
        </form>

        {/* API Guide */}
        <div className="rounded-xl p-4" style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.2)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Key size={12} style={{ color: "var(--blue)" }} />
            <p className="text-[10px] font-bold" style={{ color: "var(--blue)" }}>APIキー設定ガイド（任意）</p>
          </div>
          <div className="space-y-1.5 text-[10px]" style={{ color: "rgba(56,189,248,0.7)" }}>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>ANTHROPIC_API_KEY</span> — AIコンテンツ生成・タイトル提案に必要</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>SERPER_API_KEY</span> — SERP分析で実データを取得（serper.dev で無料取得可）</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD</span> — 被リンク分析の実データ取得</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>AI_COMPANY_MEDIA_REGISTER_URL</span> — メディア登録時にAICompanyへ同期するWebhook URL（任意）</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>AI_COMPANY_WEBHOOK_SECRET</span> — AICompany提案受信APIの共有シークレット（任意）</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>NEXT_PUBLIC_APP_URL</span> — OAuth callback URL生成用のアプリURL</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET</span> — Googleログイン</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET</span> — GitHubログイン</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>AICOMPANY_CLIENT_ID / AICOMPANY_CLIENT_SECRET</span> — AICompany OAuthログイン</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>AICOMPANY_AUTHORIZATION_URL / AICOMPANY_TOKEN_URL / AICOMPANY_USERINFO_URL</span> — AICompany OAuth endpoints</p>
            <p><span className="font-bold" style={{ color: "var(--cyan)" }}>AI_COMPANY_ID_VERIFY_URL</span> — AICompany IDログイン時の検証API</p>
            <p className="mt-1" style={{ color: "rgba(56,189,248,0.45)" }}>設定しない場合はデモデータで動作します。<code>.env.local</code> に記載してください。</p>
          </div>
        </div>

        {/* Projects list */}
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin" style={{ color: "var(--purple)" }} /></div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative w-24 h-24 mb-4">
              <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(167,139,250,0.1) 0%, transparent 70%)", animation: "pulse-glow 3s ease-in-out infinite" }} />
              <div className="absolute inset-0 flex items-center justify-center"><FolderOpen size={32} style={{ color: "rgba(167,139,250,0.25)" }} /></div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>プロジェクトがまだありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="glass rounded-xl p-4 flex items-start justify-between gap-3 cursor-default transition-all duration-200">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)" }}>
                    <FolderOpen size={15} style={{ color: "var(--purple)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{p.name}</p>
                    {p.domain && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Globe size={10} style={{ color: "var(--text-muted)" }} />
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{p.domain}</span>
                      </div>
                    )}
                    <p className="text-[9px] mt-1" style={{ color: "rgba(100,116,139,0.5)" }}>
                      作成: {new Date(p.createdAt).toLocaleDateString("ja")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] shrink-0">
                  <span className="flex items-center gap-1 badge-purple px-2 py-0.5 rounded-full">
                    <Search size={9} />{p._count.keywords} KW
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
