"use client";

import { useState } from "react";
import { Search, Loader2, CheckCircle, XCircle, AlertTriangle, Gauge, ChevronDown, ChevronUp } from "lucide-react";
import { DataOrb } from "@/components/DataOrb";

interface AuditItem { category: string; label: string; status: "pass" | "warn" | "fail"; value: string; tip: string; }
interface AuditData { url: string; score: number; passCount: number; warnCount: number; failCount: number; items: AuditItem[]; }

function StatusIcon({ status }: { status: "pass" | "warn" | "fail" }) {
  if (status === "pass") return <CheckCircle size={13} className="shrink-0" style={{ color: "#34d399" }} />;
  if (status === "warn") return <AlertTriangle size={13} className="shrink-0" style={{ color: "#fb923c" }} />;
  return <XCircle size={13} className="shrink-0" style={{ color: "#f87171" }} />;
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fb923c" : "#f87171";
  const glow = score >= 80 ? "rgba(52,211,153,0.4)" : score >= 60 ? "rgba(251,146,60,0.4)" : "rgba(248,113,113,0.4)";
  return (
    <div className="flex flex-col items-center">
      <div className="text-4xl font-bold" style={{ color, textShadow: `0 0 20px ${glow}` }}>{score}</div>
      <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--text-muted)" }}>/ 100</p>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.1)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color, boxShadow: `0 0 8px ${glow}` }} />
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AuditData | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [orbActive, setOrbActive] = useState(false);

  async function runAudit(e: React.FormEvent) {
    e.preventDefault();
    let u = url.trim();
    if (!u.startsWith("http")) u = `https://${u}`;
    setLoading(true); setOrbActive(false);
    try {
      const res = await fetch(`/api/audit?url=${encodeURIComponent(u)}`);
      const d = await res.json();
      if (d.error) { alert(d.error); return; }
      setData(d);
      setOrbActive(true);
      setTimeout(() => setOrbActive(false), 4000);
      const exp: Record<string, boolean> = {};
      for (const c of [...new Set(d.items.map((i: AuditItem) => i.category))]) exp[c as string] = true;
      setExpanded(exp);
    } finally { setLoading(false); }
  }

  const categories = data ? [...new Set(data.items.map((i) => i.category))] : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(244,114,182,0.7)" }}>SITE AUDITOR</p>
          <h1 className="text-lg font-bold" style={{ color: "#f472b6", textShadow: "0 0 12px rgba(244,114,182,0.5)" }}>サイト監査</h1>
        </div>
        <form onSubmit={runAudit} className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="監査するURL（例: https://example.com）"
              className="cyber-input pl-9 pr-4 py-2 rounded-lg text-sm w-80" />
          </div>
          <button type="submit" disabled={loading || !url.trim()} className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />}
            監査する
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin mb-4" style={{ color: "#f472b6" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>ページを解析中…（10秒ほどかかる場合があります）</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary + orb */}
            <div className="relative glass-static rounded-xl p-5 overflow-hidden">
              <DataOrb active={orbActive} />
              <div className="relative z-10 grid grid-cols-4 gap-4 items-center">
                <div className="col-span-1 pr-4" style={{ borderRight: "1px solid rgba(56,189,248,0.1)" }}>
                  <ScoreGauge score={data.score} />
                </div>
                <div className="col-span-3 grid grid-cols-3 gap-3">
                  {[
                    { label: "合格", value: data.passCount, color: "#34d399" },
                    { label: "警告", value: data.warnCount, color: "#fb923c" },
                    { label: "失敗", value: data.failCount, color: "#f87171" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="stat-card rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{label}</p>
                    </div>
                  ))}
                  <div className="col-span-3">
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>監査URL: <span style={{ color: "var(--blue)" }}>{data.url}</span></p>
                  </div>
                </div>
              </div>
            </div>

            {/* Categories */}
            <div className="space-y-3">
              {categories.map((cat) => {
                const items = data.items.filter((i) => i.category === cat);
                const isOpen = expanded[cat] !== false;
                const failN = items.filter((i) => i.status === "fail").length;
                const warnN = items.filter((i) => i.status === "warn").length;
                return (
                  <div key={cat} className="glass-static rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpanded((p) => ({ ...p, [cat]: !isOpen }))}
                      className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                      style={{ borderBottom: isOpen ? "1px solid rgba(56,189,248,0.08)" : "none" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{cat}</span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{items.length}項目</span>
                        {failN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}>NG {failN}</span>}
                        {warnN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" }}>警告 {warnN}</span>}
                      </div>
                      {isOpen ? <ChevronUp size={13} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />}
                    </button>
                    {isOpen && (
                      <div>
                        {items.map((item) => (
                          <div key={item.label} className="px-4 py-3 transition-colors"
                            style={{ borderBottom: "1px solid rgba(56,189,248,0.05)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = item.status === "fail" ? "rgba(248,113,113,0.03)" : item.status === "warn" ? "rgba(251,146,60,0.03)" : "rgba(52,211,153,0.02)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <div className="flex items-start gap-2.5">
                              <StatusIcon status={item.status} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-medium" style={{ color: "var(--text)" }}>{item.label}</p>
                                  <p className="text-[10px] text-right shrink-0 max-w-48 truncate" style={{ color: "var(--text-muted)" }}>{item.value}</p>
                                </div>
                                {item.status !== "pass" && (
                                  <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: item.status === "fail" ? "rgba(248,113,113,0.8)" : "rgba(251,146,60,0.8)" }}>
                                    💡 {item.tip}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!data && !loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-32 h-32 mb-6">
              <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(244,114,182,0.12) 0%, transparent 70%)", animation: "pulse-glow 3s ease-in-out infinite" }} />
              <div className="absolute inset-0 flex items-center justify-center"><Gauge size={36} style={{ color: "rgba(244,114,182,0.3)" }} /></div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>URLを入力してSEO監査を開始</p>
            <p className="text-xs mt-1" style={{ color: "rgba(100,116,139,0.5)" }}>タイトル・メタ・H1・canonical・robots・OGP・構造化データなどをチェックします</p>
          </div>
        )}
      </div>
    </div>
  );
}
