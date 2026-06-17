"use client";

import { useState } from "react";
import { Search, Loader2, Link2, AlertCircle, ExternalLink, TrendingUp, Shield } from "lucide-react";
import { DataOrb } from "@/components/DataOrb";

interface BacklinkData { domain: string; totalBacklinks: number; referringDomains: number; dofollowRatio: number; domainAuthority: number; topReferrers: { domain: string; da: number; links: number; type: string; anchor: string; }[]; opportunities: { domain: string; da: number; reason: string; difficulty: string; }[]; isMock: boolean; note?: string; }

export default function BacklinksPage() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BacklinkData | null>(null);
  const [orbActive, setOrbActive] = useState(false);

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    const d = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) return;
    setLoading(true); setOrbActive(false);
    try {
      const res = await fetch(`/api/backlinks?domain=${encodeURIComponent(d)}`);
      setData(await res.json());
      setOrbActive(true);
      setTimeout(() => setOrbActive(false), 4000);
    } finally { setLoading(false); }
  }

  const diffStyle: Record<string, React.CSSProperties> = {
    低: { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" },
    中: { background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" },
    高: { background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" },
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(251,146,60,0.7)" }}>LINK INTELLIGENCE</p>
          <h1 className="text-lg font-bold" style={{ color: "#fb923c", textShadow: "0 0 12px rgba(251,146,60,0.5)" }}>被リンク分析</h1>
        </div>
        <form onSubmit={analyze} className="flex gap-2">
          <div className="relative">
            <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="ドメインを入力（例: example.com）"
              className="cyber-input pl-9 pr-4 py-2 rounded-lg text-sm w-72" />
          </div>
          <button type="submit" disabled={loading || !domain.trim()} className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            分析する
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {data && (
          <>
            {data.isMock && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.25)" }}>
                <AlertCircle size={13} style={{ color: "#fb923c", flexShrink: 0 }} />
                <p className="text-xs" style={{ color: "#fb923c" }}>{data.note}</p>
              </div>
            )}

            {/* Stats + orb */}
            <div className="relative glass-static rounded-xl p-5 overflow-hidden">
              <DataOrb active={orbActive} />
              <div className="relative z-10 grid grid-cols-4 gap-3">
                {[
                  { label: "被リンク総数", value: data.totalBacklinks.toLocaleString(), icon: Link2, color: "#fb923c" },
                  { label: "参照ドメイン数", value: data.referringDomains.toLocaleString(), icon: TrendingUp, color: "#a78bfa" },
                  { label: "dofollow率", value: `${data.dofollowRatio}%`, icon: Shield, color: "#34d399" },
                  { label: "ドメイン権威 DA", value: String(data.domainAuthority), icon: TrendingUp, color: "#38bdf8" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="stat-card rounded-xl p-3 text-center">
                    <Icon size={13} className="mx-auto mb-1" style={{ color }} />
                    <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                    <p className="text-xl font-bold" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Top referrers */}
              <div className="glass-static rounded-xl overflow-hidden">
                <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>主要参照ドメイン</p>
                </div>
                <div>
                  {data.topReferrers.map((r) => (
                    <div key={r.domain} className="px-4 py-3 flex items-center gap-3 transition-colors"
                      style={{ borderBottom: "1px solid rgba(56,189,248,0.06)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium flex items-center gap-1 group" style={{ color: "var(--blue)" }}>
                            {r.domain}
                            <ExternalLink size={10} className="opacity-0 group-hover:opacity-100" />
                          </a>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                            style={r.type === "dofollow" ? { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" } : { background: "rgba(100,116,139,0.12)", border: "1px solid rgba(100,116,139,0.3)", color: "var(--text-muted)" }}>
                            {r.type}
                          </span>
                        </div>
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>アンカー: <span style={{ color: "var(--text-dim)" }}>{r.anchor}</span></p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{r.links}</p>
                        <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>リンク数</p>
                        <p className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>DA {r.da}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Opportunities */}
              <div className="glass-static rounded-xl overflow-hidden">
                <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>推奨リンク獲得先</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>アプローチすべき被リンク候補サイト</p>
                </div>
                <div>
                  {data.opportunities.map((op) => (
                    <div key={op.domain} className="px-4 py-3 transition-colors" style={{ borderBottom: "1px solid rgba(56,189,248,0.06)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <a href={`https://${op.domain}`} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium flex items-center gap-1 group" style={{ color: "var(--blue)" }}>
                          {op.domain}
                          <ExternalLink size={10} className="opacity-0 group-hover:opacity-100" />
                        </a>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>DA {op.da}</span>
                          <span className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                            style={diffStyle[op.difficulty] ?? { background: "rgba(100,116,139,0.12)", color: "var(--text-muted)" }}>
                            {op.difficulty}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{op.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {!data && !loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-32 h-32 mb-6">
              <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(251,146,60,0.12) 0%, transparent 70%)", animation: "pulse-glow 3s ease-in-out infinite" }} />
              <div className="absolute inset-0 flex items-center justify-center"><Link2 size={36} style={{ color: "rgba(251,146,60,0.3)" }} /></div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>ドメインを入力して被リンクを分析</p>
            <p className="text-xs mt-1" style={{ color: "rgba(100,116,139,0.5)" }}>https:// は省略してOKです（例: example.com）</p>
          </div>
        )}
      </div>
    </div>
  );
}
