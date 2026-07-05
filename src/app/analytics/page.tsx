"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  LineChart, Loader2, RefreshCw, Play, Globe, TrendingUp, MousePointerClick,
  Eye, Search, AlertCircle, ExternalLink, PenLine, Activity,
} from "lucide-react";

interface MediaItem {
  id: string; name: string; domain: string;
  wpUrl?: string | null; gscProperty?: string | null; ga4PropertyId?: string | null;
}
interface Row {
  url: string; path: string; title: string | null;
  impressions: number; clicks: number; ctr: number; position: number; views: number;
  queries: { query: string; impressions: number; position: number; clicks: number }[];
  candidate: null | { type: "rank" | "ctr"; reason: string; score: number };
}
interface Data {
  gscConnected: boolean; ga4Connected: boolean; property: string | null; ga4PropertyId: string | null;
  days: number;
  summary: { totalImpressions: number; totalClicks: number; avgPosition: number; totalViews: number; pageCount: number; candidateCount: number };
  rows: Row[];
  candidates: Row[];
  topQueries: { key: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

const DAYS = [7, 28, 90];

export default function AnalyticsPage() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaId, setMediaId] = useState("");
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [msg, setMsg] = useState("");
  const [ga4List, setGa4List] = useState<{ propertyId: string; displayName: string; account: string }[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const selected = media.find((m) => m.id === mediaId) ?? null;

  useEffect(() => {
    fetch("/api/media").then((r) => (r.ok ? r.json() : [])).then((d: MediaItem[]) => {
      setMedia(d); setMediaId((p) => p || d[0]?.id || "");
    });
  }, []);

  const load = useCallback(async () => {
    if (!mediaId) return;
    setLoading(true); setMsg("");
    try {
      const r = await fetch(`/api/analytics?mediaId=${mediaId}&days=${days}`);
      const d = await r.json();
      if (r.ok) setData(d); else setMsg(d.error ?? "取得に失敗しました");
    } finally { setLoading(false); }
  }, [mediaId, days]);

  useEffect(() => { setData(null); load(); }, [load]);

  async function startGsc() {
    if (!mediaId || measuring) return;
    setMeasuring(true); setMsg("");
    try {
      const r = await fetch("/api/analytics/measure", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, action: "gsc" }),
      });
      const d = await r.json();
      if (r.ok) { setMsg("✅ 計測を開始しました。データが反映されるまで数日かかる場合があります。"); await refreshMedia(); await load(); }
      else setMsg(`❌ ${d.error ?? "計測開始に失敗しました"}`);
    } finally { setMeasuring(false); }
  }

  async function attachGa4(propertyId: string) {
    setMeasuring(true); setMsg("");
    try {
      const r = await fetch("/api/analytics/measure", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, action: "ga4", ga4PropertyId: propertyId }),
      });
      const d = await r.json();
      if (r.ok) { setGa4List(null); await refreshMedia(); await load(); } else setMsg(`❌ ${d.error ?? "GA4紐付けに失敗しました"}`);
    } finally { setMeasuring(false); }
  }

  async function refreshMedia() {
    const d = (await (await fetch("/api/media")).json()) as MediaItem[];
    setMedia(d);
  }

  async function openGa4Picker() {
    setGa4List([]);
    const d = await (await fetch("/api/analytics/ga4-properties")).json();
    setGa4List(d.properties ?? []);
  }

  const num = (n: number) => n.toLocaleString();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(250,204,21,0.12)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.4)" }}>
            <LineChart size={17} style={{ color: "#facc15" }} />
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(250,204,21,0.75)" }}>SEO ANALYTICS</p>
            <h1 className="text-lg font-bold" style={{ color: "var(--text)" }}>分析ダッシュボード</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={mediaId} onChange={(e) => setMediaId(e.target.value)} className="cyber-input px-3 py-1.5 rounded-lg text-xs">
            {media.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(56,189,248,0.2)" }}>
            {DAYS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className="px-2.5 py-1.5 text-[11px] font-bold"
                style={days === d ? { background: "rgba(250,204,21,0.15)", color: "#facc15" } : { color: "var(--text-muted)" }}>{d}日</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="cyber-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {msg && <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: msg.startsWith("✅") ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)", border: `1px solid ${msg.startsWith("✅") ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`, color: msg.startsWith("✅") ? "#34d399" : "#f87171" }}>{msg}</div>}

        {/* 計測状態 / 開始 */}
        <div className="glass-static rounded-xl p-4 flex flex-wrap items-center gap-3">
          <Globe size={16} style={{ color: data?.gscConnected ? "#34d399" : "var(--text-muted)" }} />
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs font-bold" style={{ color: "var(--text)" }}>
              Search Console {data?.gscConnected ? "計測中 ✅" : "未計測"}
              <span className="ml-3">GA4 {data?.ga4Connected ? "計測中 ✅" : "未接続"}</span>
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {data?.property ? `プロパティ: ${data.property}` : selected ? `${selected.name}（${selected.domain}）` : ""}
            </p>
          </div>
          {!data?.gscConnected && selected?.wpUrl && (
            <button onClick={startGsc} disabled={measuring} className="cyber-btn-primary flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {measuring ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 計測を開始（ワンクリック）
            </button>
          )}
          {!selected?.wpUrl && !data?.gscConnected && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>※ 先にプラグインでWordPress連携が必要です</span>
          )}
          {!data?.ga4Connected && (
            <button onClick={openGa4Picker} disabled={measuring} className="cyber-btn flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold disabled:opacity-40">
              <Activity size={12} /> GA4を追加
            </button>
          )}
        </div>

        {/* GA4 picker */}
        {ga4List && (
          <div className="glass-static rounded-xl p-4">
            <p className="text-xs font-bold mb-2" style={{ color: "var(--text)" }}>既存のGA4プロパティを選択</p>
            {ga4List.length === 0 ? <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>読み込み中… / アクセス可能なGA4プロパティがありません</p> : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {ga4List.map((p) => (
                  <button key={p.propertyId} onClick={() => attachGa4(p.propertyId)} disabled={measuring}
                    className="w-full text-left rounded-lg px-3 py-2 flex items-center gap-2 disabled:opacity-40" style={{ background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.12)" }}>
                    <Activity size={12} style={{ color: "var(--cyan)" }} />
                    <span className="text-[11px] font-semibold flex-1" style={{ color: "var(--text)" }}>{p.displayName}</span>
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{p.account} · {p.propertyId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && !data && <div className="flex items-center gap-2 text-sm p-8 justify-center" style={{ color: "var(--text-muted)" }}><Loader2 size={16} className="animate-spin" /> 読み込み中…</div>}

        {data && (
          <>
            {/* サマリー */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat icon={Eye} color="#38bdf8" label="表示回数" value={num(data.summary.totalImpressions)} />
              <Stat icon={MousePointerClick} color="#34d399" label="クリック" value={num(data.summary.totalClicks)} />
              <Stat icon={TrendingUp} color="#facc15" label="平均掲載順位" value={data.summary.avgPosition ? data.summary.avgPosition.toFixed(1) : "—"} />
              <Stat icon={Activity} color="#a78bfa" label="PV (GA4)" value={data.summary.totalViews ? num(data.summary.totalViews) : "—"} />
              <Stat icon={PenLine} color="#fb923c" label="リライト候補" value={String(data.summary.candidateCount)} />
            </div>

            {/* リライト候補 */}
            {data.candidates.length > 0 && (
              <div className="glass-static rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(251,146,60,0.15)" }}>
                  <AlertCircle size={14} style={{ color: "#fb923c" }} />
                  <p className="text-xs font-bold" style={{ color: "#fb923c" }}>リライト推奨（伸びしろが大きい記事）</p>
                </div>
                <div className="divide-y" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
                  {data.candidates.map((r, i) => (
                    <div key={i} className="px-4 py-2.5" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: r.candidate!.type === "rank" ? "rgba(250,204,21,0.15)" : "rgba(167,139,250,0.15)", color: r.candidate!.type === "rank" ? "#facc15" : "#a78bfa" }}>
                          {r.candidate!.type === "rank" ? "順位UP" : "CTR改善"}
                        </span>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold truncate flex-1 min-w-0" style={{ color: "var(--text)" }}>{r.title ?? r.path}</a>
                        <p className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>順位 <b style={{ color: "#facc15" }}>{r.position.toFixed(1)}</b> / {num(r.impressions)}表示</p>
                      </div>
                      {r.queries.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5 pl-[52px]">
                          {r.queries.slice(0, 5).map((q, j) => (
                            <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", color: "var(--text)" }}>
                              <Search size={8} style={{ color: "var(--cyan)" }} />{q.query}
                              <b style={{ color: q.position <= 10 ? "#34d399" : "#facc15" }}>{q.position.toFixed(0)}位</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ページ別テーブル */}
            <div className="glass-static rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                <p className="text-xs font-bold" style={{ color: "var(--text)" }}>ページ別パフォーマンス（{data.summary.pageCount}件）</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ color: "var(--text-muted)" }}>
                      <th className="text-left font-bold px-4 py-2">ページ</th>
                      <th className="text-right font-bold px-2 py-2">表示</th>
                      <th className="text-right font-bold px-2 py-2">クリック</th>
                      <th className="text-right font-bold px-2 py-2">CTR</th>
                      <th className="text-right font-bold px-2 py-2">順位</th>
                      <th className="text-right font-bold px-4 py-2">PV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 100).map((r, i) => {
                      const open = expanded === r.url;
                      return (
                        <Fragment key={i}>
                          <tr onClick={() => setExpanded(open ? null : r.url)} className="cursor-pointer" style={{ borderTop: "1px solid rgba(56,189,248,0.06)", background: open ? "rgba(56,189,248,0.04)" : undefined }}>
                            <td className="px-4 py-2 max-w-[340px]">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate flex-1" style={{ color: "var(--text)" }}>{r.title ?? r.path}</span>
                                {r.queries.length > 0 && <span className="text-[8px] px-1 rounded shrink-0" style={{ background: "rgba(34,211,238,0.12)", color: "var(--cyan)" }}>KW{r.queries.length}</span>}
                                <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0"><ExternalLink size={9} style={{ color: "var(--text-muted)" }} /></a>
                              </div>
                              {/* 代表キーワード（1位のもの）を常時1つ表示 */}
                              {r.queries[0] && <p className="text-[9px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>🔍 {r.queries[0].query}（{r.queries[0].position.toFixed(0)}位）</p>}
                            </td>
                            <td className="text-right px-2 py-2" style={{ color: "var(--text)" }}>{num(r.impressions)}</td>
                            <td className="text-right px-2 py-2" style={{ color: "var(--text)" }}>{num(r.clicks)}</td>
                            <td className="text-right px-2 py-2" style={{ color: r.ctr >= 0.03 ? "#34d399" : "var(--text-muted)" }}>{(r.ctr * 100).toFixed(1)}%</td>
                            <td className="text-right px-2 py-2" style={{ color: r.position > 0 && r.position <= 10 ? "#34d399" : r.position <= 20 ? "#facc15" : "var(--text-muted)" }}>{r.position ? r.position.toFixed(1) : "—"}</td>
                            <td className="text-right px-4 py-2" style={{ color: "var(--text-muted)" }}>{r.views ? num(r.views) : "—"}</td>
                          </tr>
                          {open && r.queries.length > 0 && (
                            <tr style={{ background: "rgba(56,189,248,0.03)" }}>
                              <td colSpan={6} className="px-4 py-2">
                                <p className="text-[9px] font-bold mb-1" style={{ color: "var(--text-muted)" }}>このページが順位を取っているキーワード</p>
                                <div className="overflow-x-auto">
                                  <table className="text-[10px]">
                                    <tbody>
                                      {r.queries.map((q, j) => (
                                        <tr key={j}>
                                          <td className="pr-4 py-0.5" style={{ color: "var(--text)" }}>{q.query}</td>
                                          <td className="pr-4 py-0.5 text-right" style={{ color: q.position <= 10 ? "#34d399" : "#facc15" }}>{q.position.toFixed(1)}位</td>
                                          <td className="pr-4 py-0.5 text-right" style={{ color: "var(--text-muted)" }}>{num(q.impressions)}表示</td>
                                          <td className="py-0.5 text-right" style={{ color: "var(--text-muted)" }}>{num(q.clicks)}クリック</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 上位クエリ */}
            {data.topQueries.length > 0 && (
              <div className="glass-static rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                  <Search size={13} style={{ color: "var(--cyan)" }} />
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>流入キーワード（上位）</p>
                </div>
                <div className="p-3 flex flex-wrap gap-1.5">
                  {data.topQueries.map((q, i) => (
                    <span key={i} className="text-[10px] px-2 py-1 rounded-full" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", color: "var(--text)" }}>
                      {q.key} <span style={{ color: "var(--text-muted)" }}>({num(q.impressions)}·{q.position.toFixed(0)}位)</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.rows.length === 0 && (
              <div className="glass-static rounded-xl p-8 text-center">
                <Globe size={32} style={{ color: "rgba(250,204,21,0.3)" }} className="mx-auto" />
                <p className="text-sm font-bold mt-3" style={{ color: "var(--text)" }}>まだデータがありません</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {data.gscConnected ? "計測開始後、データが貯まるまで数日かかります。" : "「計測を開始」を押すとSearch Consoleの計測が始まります。"}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, color, label, value }: { icon: typeof Eye; color: string; label: string; value: string }) {
  return (
    <div className="glass-static rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} style={{ color }} />
        <p className="text-[9px] font-bold" style={{ color: "var(--text-muted)" }}>{label}</p>
      </div>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
