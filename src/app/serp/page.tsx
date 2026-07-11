"use client";

import { useState } from "react";
import { Search, Loader2, ExternalLink, AlertCircle, FileText, Hash, Video, HelpCircle } from "lucide-react";
import { DataOrb } from "@/components/DataOrb";

interface SerpResult { position: number; title: string; url: string; description: string; domain: string; domainAuthority: number; wordCount: number; h2Count: number; hasVideo: boolean; hasFaq: boolean; }
interface SerpData { keyword: string; results: SerpResult[]; analysis: { avgWordCount: number; recommendedWordCount: number; minWordCount: number; maxWordCount: number; avgDA: number; avgH2: number; withVideoPercent: number; withFaqPercent: number; }; cooccurrences: string[]; isMock: boolean; note?: string; }

function DaBar({ da }: { da: number }) {
  const color = da >= 70 ? "#f87171" : da >= 50 ? "#fb923c" : "#34d399";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.1)" }}>
        <div className="h-full rounded-full" style={{ width: `${da}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{da}</span>
    </div>
  );
}

export default function SerpPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SerpData | null>(null);
  const [orbActive, setOrbActive] = useState(false);

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setOrbActive(false);
    try {
      const res = await fetch(`/api/serp?q=${encodeURIComponent(query.trim())}`);
      setData(await res.json());
      setOrbActive(true);
      setTimeout(() => setOrbActive(false), 4000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(167,139,250,0.7)" }}>SERP ANALYZER</p>
          <h1 className="text-lg font-bold" style={{ color: "var(--purple)", textShadow: "0 0 12px rgba(167,139,250,0.5)" }}>SERP分析</h1>
        </div>
        <form onSubmit={analyze} className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="分析するキーワードを入力…" className="cyber-input pl-9 pr-4 py-2 rounded-lg text-sm w-72" />
          </div>
          <button type="submit" disabled={loading || !query.trim()} className="cyber-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
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

            {/* Summary + orb */}
            <div className="relative glass-static rounded-xl p-5 overflow-hidden">
              <DataOrb active={orbActive} />
              <div className="relative z-10 grid grid-cols-4 gap-3">
                {[
                  { label: "推奨文字数", value: `${data.analysis.recommendedWordCount.toLocaleString()}字`, sub: "以上", color: "#a78bfa" },
                  { label: "平均文字数", value: data.analysis.avgWordCount.toLocaleString(), sub: `${data.analysis.minWordCount.toLocaleString()}〜${data.analysis.maxWordCount.toLocaleString()}`, color: "#38bdf8" },
                  { label: "平均H2数", value: String(data.analysis.avgH2), sub: "見出し", color: "#34d399" },
                  { label: "平均ドメイン権威", value: String(data.analysis.avgDA), sub: "DA (0-100)", color: "#fb923c" },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="stat-card rounded-xl p-3 text-center">
                    <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                    <p className="text-xl font-bold" style={{ color }}>{value}</p>
                    <p className="text-[9px] mt-0.5" style={{ color: "rgba(100,116,139,0.6)" }}>{sub}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* SERP list */}
              <div className="col-span-2 glass-static rounded-xl overflow-hidden">
                <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>上位10サイト</p>
                </div>
                <div className="divide-y" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
                  {data.results.map((r) => (
                    <div key={r.position} className="px-4 py-3 transition-colors" style={{ cursor: "default" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(56,189,248,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", color: "var(--purple)" }}>
                          {r.position}
                        </span>
                        <div className="flex-1 min-w-0">
                          <a href={r.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium flex items-center gap-1 mb-0.5 group"
                            style={{ color: "var(--blue)" }}>
                            <span className="truncate">{r.title}</span>
                            <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
                          </a>
                          <p className="text-[10px] truncate mb-1.5" style={{ color: "var(--text-muted)" }}>{r.url}</p>
                          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>{r.description}</p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                              <FileText size={10} />{r.wordCount.toLocaleString()}字
                            </span>
                            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                              <Hash size={10} />H2×{r.h2Count}
                            </span>
                            {r.hasVideo && <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--purple)" }}><Video size={10} />動画</span>}
                            {r.hasFaq && <span className="flex items-center gap-1 text-[10px]" style={{ color: "#34d399" }}><HelpCircle size={10} />FAQ</span>}
                            <DaBar da={r.domainAuthority} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                <div className="glass-static rounded-xl p-4">
                  <p className="text-xs font-bold mb-3" style={{ color: "var(--text)" }}>SERPの特徴</p>
                  {[
                    { label: "動画あり", pct: data.analysis.withVideoPercent, color: "var(--purple)" },
                    { label: "FAQ含む", pct: data.analysis.withFaqPercent, color: "#34d399" },
                  ].map(({ label, pct, color }) => (
                    <div key={label} className="mb-3">
                      <div className="flex justify-between text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>
                        <span>{label}</span><span>{pct}%</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.1)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 text-[10px] space-y-1" style={{ color: "var(--text-muted)", borderTop: "1px solid rgba(56,189,248,0.08)" }}>
                    {data.analysis.withVideoPercent > 50 && <p style={{ color: "#fb923c" }}>→ 動画コンテンツの追加を検討</p>}
                    {data.analysis.withFaqPercent > 50 && <p style={{ color: "#34d399" }}>→ FAQセクション追加を推奨</p>}
                    {data.analysis.avgDA > 70 && <p style={{ color: "#f87171" }}>→ 高権威ドメインが多く競争激しい</p>}
                  </div>
                </div>

                <div className="glass-static rounded-xl p-4">
                  <p className="text-xs font-bold mb-3" style={{ color: "var(--text)" }}>共起語・関連語</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.cooccurrences.map((word) => (
                      <span key={word} className="badge-blue text-[10px] px-2 py-0.5 rounded-full">{word}</span>
                    ))}
                  </div>
                  <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>記事内に自然に含めましょう</p>
                </div>
              </div>
            </div>
          </>
        )}

        {!data && !loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-32 h-32 mb-6">
              <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(167,139,250,0.12) 0%, transparent 70%)", animation: "pulse-glow 3s ease-in-out infinite" }} />
              <div className="absolute inset-0 flex items-center justify-center"><Search size={36} style={{ color: "rgba(167,139,250,0.3)" }} /></div>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>キーワードを入力して上位10サイトを分析</p>
          </div>
        )}
      </div>
    </div>
  );
}
