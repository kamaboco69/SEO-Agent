"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, Trash2, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

interface Ranking { id: string; position: number; checkedAt: string; }
interface TrackedKw { id: string; keyword: string; targetUrl: string | null; rankings: Ranking[]; createdAt: string; }

function PositionChange({ rankings }: { rankings: Ranking[] }) {
  if (rankings.length < 2) return <Minus size={13} style={{ color: "rgba(100,116,139,0.4)" }} />;
  const diff = rankings[1].position - rankings[0].position;
  if (diff > 0) return <span className="flex items-center gap-0.5 text-[10px] font-bold" style={{ color: "#34d399" }}><TrendingUp size={11} />+{diff}</span>;
  if (diff < 0) return <span className="flex items-center gap-0.5 text-[10px] font-bold" style={{ color: "#f87171" }}><TrendingDown size={11} />{diff}</span>;
  return <Minus size={13} style={{ color: "rgba(100,116,139,0.4)" }} />;
}

function PositionBadge({ pos }: { pos: number }) {
  const style =
    pos <= 3 ? { background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24" } :
    pos <= 10 ? { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" } :
    pos <= 20 ? { background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "var(--blue)" } :
    { background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.2)", color: "var(--text-muted)" };
  return <span className="w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold" style={style}>{pos}</span>;
}

export default function TrackerPage() {
  const [keywords, setKeywords] = useState<TrackedKw[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/tracker");
    setKeywords(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setAdding(true);
    await fetch("/api/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword: keyword.trim(), targetUrl: targetUrl.trim() || null }) });
    setKeyword(""); setTargetUrl("");
    await load(); setAdding(false);
  }

  async function removeKeyword(id: string) {
    await fetch(`/api/tracker?id=${id}`, { method: "DELETE" });
    setKeywords((prev) => prev.filter((k) => k.id !== id));
  }

  const top3 = keywords.filter((k) => k.rankings[0]?.position <= 3).length;
  const top10 = keywords.filter((k) => k.rankings[0]?.position <= 10).length;
  const top20 = keywords.filter((k) => k.rankings[0]?.position <= 20).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(56,189,248,0.7)" }}>RANK TRACKER</p>
          <h1 className="text-lg font-bold" style={{ color: "var(--blue)", textShadow: "0 0 12px rgba(56,189,248,0.5)" }}>順位トラッカー</h1>
        </div>
        <button onClick={load} className="transition-colors p-2 rounded-lg" style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--blue)"; e.currentTarget.style.background = "rgba(56,189,248,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}>
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Summary */}
        {keywords.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "追跡中", value: keywords.length, color: "var(--text)" },
              { label: "TOP 3", value: top3, color: "#fbbf24" },
              { label: "TOP 10", value: top10, color: "#34d399" },
              { label: "TOP 20", value: top20, color: "var(--blue)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="stat-card rounded-xl p-3 text-center">
                <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                <p className="text-xl font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <form onSubmit={addKeyword} className="glass-static rounded-xl p-4">
          <p className="text-xs font-bold tracking-wider mb-3" style={{ color: "var(--blue)" }}>+ キーワードを追加</p>
          <div className="flex gap-2 flex-wrap">
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="追跡するキーワード（例: コンテンツSEO）"
              className="cyber-input flex-1 min-w-48 px-3 py-2 rounded-lg text-sm" />
            <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="対象URL（任意）"
              className="cyber-input flex-1 min-w-48 px-3 py-2 rounded-lg text-sm" />
            <button type="submit" disabled={adding || !keyword.trim()} className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              追加
            </button>
          </div>
        </form>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--blue)" }} />
          </div>
        ) : keywords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative w-24 h-24 mb-4">
              <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(56,189,248,0.1) 0%, transparent 70%)", animation: "pulse-glow 3s ease-in-out infinite" }} />
              <div className="absolute inset-0 flex items-center justify-center"><TrendingUp size={32} style={{ color: "rgba(56,189,248,0.25)" }} /></div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>追跡するキーワードを追加してください</p>
          </div>
        ) : (
          <div className="glass-static rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs cyber-table">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)" }}>キーワード</th>
                    <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--text-muted)" }}>現在順位</th>
                    <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--text-muted)" }}>変動</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)" }}>対象URL</th>
                    <th className="text-center px-3 py-3 font-medium" style={{ color: "var(--text-muted)" }}>履歴</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((kw) => {
                    const latestPos = kw.rankings[0]?.position;
                    return (
                      <tr key={kw.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium" style={{ color: "var(--text)" }}>{kw.keyword}</p>
                          <p className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>追加: {new Date(kw.createdAt).toLocaleDateString("ja")}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {latestPos ? <PositionBadge pos={latestPos} /> : <span style={{ color: "rgba(100,116,139,0.3)" }}>-</span>}
                        </td>
                        <td className="px-4 py-3 text-center"><PositionChange rankings={kw.rankings} /></td>
                        <td className="px-4 py-3">
                          {kw.targetUrl
                            ? <a href={kw.targetUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] truncate block max-w-48 hover:underline" style={{ color: "var(--blue)" }}>{kw.targetUrl}</a>
                            : <span className="text-[10px]" style={{ color: "rgba(100,116,139,0.3)" }}>未設定</span>
                          }
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {kw.rankings.slice(0, 10).map((r, i) => {
                              const barColor = r.position <= 3 ? "#fbbf24" : r.position <= 10 ? "#34d399" : r.position <= 20 ? "var(--blue)" : "rgba(100,116,139,0.3)";
                              return <div key={r.id} title={`順位${r.position}`} className="w-1.5 h-5 rounded-sm" style={{ background: barColor, opacity: 1 - i * 0.06 }} />;
                            })}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => removeKeyword(kw.id)} className="transition-colors"
                            style={{ color: "rgba(100,116,139,0.35)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(100,116,139,0.35)"; }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
