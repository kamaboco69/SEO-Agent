"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  History, Loader2, ExternalLink, FileText, Eye, CheckCircle2, Rocket,
  Globe, RefreshCw, PenLine, Sparkles,
} from "lucide-react";

interface ArticleRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  origin: string; // manual / schedule
  clientName: string | null;
  targetTheme: string | null;
  selectedArticle: string | null;
  finalArticleTitle: string | null;
  targetWordCount: number | null;
  wpPostId: number | null;
  wpEditLink: string | null;
  wpViewLink: string | null;
  wpPublished: boolean;
  gdocId: string | null;
  gdocUrl: string | null;
  imagesGenerated: boolean;
  media: { id: string; name: string; domain: string; wpUrl: string | null } | null;
  canApprove: boolean;
}

const FILTERS = [
  { id: "all", label: "すべて" },
  { id: "in_progress", label: "生成中" },
  { id: "published", label: "WP公開済み" },
  { id: "wp_draft", label: "WP下書き" },
  { id: "doc_only", label: "Docのみ" },
] as const;

function statusOf(a: ArticleRow): { label: string; color: string } {
  if (a.status === "error") return { label: "エラー（自動停止）", color: "#f87171" };
  if (a.status === "paused") return { label: "停止中", color: "#fb923c" };
  if (a.status === "in_progress") return { label: "生成中", color: "#facc15" };
  if (a.wpPublished) return { label: "WP公開済み", color: "#34d399" };
  if (a.wpPostId) return { label: "WP下書き", color: "#38bdf8" };
  if (a.gdocUrl) return { label: "Doc下書き", color: "#a78bfa" };
  return { label: "完了", color: "#94a3b8" };
}

function matchFilter(a: ArticleRow, f: string): boolean {
  if (f === "all") return true;
  if (f === "in_progress") return a.status === "in_progress";
  if (f === "published") return a.wpPublished;
  if (f === "wp_draft") return Boolean(a.wpPostId) && !a.wpPublished;
  if (f === "doc_only") return !a.wpPostId && Boolean(a.gdocUrl);
  return true;
}

// 装飾HTMLを別ウィンドウでレンダリングしてプレビュー
function openPreview(html: string, title = "プレビュー") {
  const w = window.open("", "_blank", "width=840,height=920");
  if (!w) { alert("ポップアップがブロックされました。ブラウザでポップアップを許可してください。"); return; }
  const doc = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>img{max-width:100%;height:auto}body{max-width:760px;margin:24px auto;padding:0 18px;font-family:-apple-system,'Segoe UI',Meiryo,sans-serif;line-height:1.9;color:#1a202c;background:#fff}</style></head><body>${html}</body></html>`;
  w.document.open();
  w.document.write(doc);
  w.document.close();
}

export default function ArticlesPage() {
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [mediaFilter, setMediaFilter] = useState<string>("all"); // all / free / <mediaId>
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/articles");
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const mediaOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.media) map.set(r.media.id, r.media.name);
    return [...map.entries()];
  }, [rows]);

  const filtered = rows.filter((a) => {
    if (!matchFilter(a, filter)) return false;
    if (mediaFilter === "all") return true;
    if (mediaFilter === "free") return !a.media;
    return a.media?.id === mediaFilter;
  });

  async function preview(a: ArticleRow) {
    const res = await fetch(`/api/pipeline?id=${a.id}`);
    if (!res.ok) { alert("記事の取得に失敗しました"); return; }
    const wf = await res.json();
    const swell = (wf.steps ?? []).find((s: { key: string }) => s.key === "swell_format");
    const html = wf.finalHtml ?? swell?.output?.html ?? null;
    const title = a.finalArticleTitle ?? a.selectedArticle ?? "プレビュー";
    if (html) openPreview(html, title);
    else if (wf.finalArticle) openPreview(`<h1>${title}</h1><pre style="white-space:pre-wrap;font-family:inherit">${wf.finalArticle}</pre>`, title);
    else alert("プレビューできる本文がまだありません");
  }

  // 承認: 最新Googleドキュメント取得→装飾し直し→（既存フローで）画像付きWP下書き
  async function approve(a: ArticleRow) {
    if (busyId) return;
    if (!confirm(
      `「${a.finalArticleTitle ?? a.selectedArticle}」を承認しますか？\n\n` +
      "最新のGoogleドキュメントの内容を取り込み、WordPress用に装飾し直して画像付きで下書き保存します。\n" +
      "（数分かかります。画像は作り直されます）"
    )) return;
    setBusyId(a.id);
    setError(null);
    setNotice(null);
    try {
      setBusyLabel("最新のGoogleドキュメントを確認し、装飾HTMLを再生成中…（1〜2分）");
      const r1 = await fetch("/api/articles/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: a.id }),
      });
      const d1 = await r1.json().catch(() => ({}));
      if (!r1.ok) throw new Error(d1.error ?? "承認に失敗しました");

      setBusyLabel("画像を生成してWordPressへ下書き保存中…（2〜3分）");
      const r2 = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: a.id, action: "wp_draft" }),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(d2.error ?? "WordPress保存に失敗しました");

      setNotice(
        `「${a.finalArticleTitle ?? a.selectedArticle}」をWordPressに下書き保存しました` +
        (d1.docUpdated ? "（Googleドキュメントの修正を反映済み）" : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認に失敗しました");
    } finally {
      setBusyId(null);
      setBusyLabel("");
    }
  }

  // WordPressで公開（既存の下書きを公開状態に）
  async function publish(a: ArticleRow) {
    if (busyId) return;
    if (!confirm(`「${a.finalArticleTitle ?? a.selectedArticle}」をWordPressで公開しますか？`)) return;
    setBusyId(a.id);
    setBusyLabel("WordPressで公開中…");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: a.id, action: "wp_publish" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "公開に失敗しました");
      setNotice(`「${a.finalArticleTitle ?? a.selectedArticle}」を公開しました`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "公開に失敗しました");
    } finally {
      setBusyId(null);
      setBusyLabel("");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)" }}>
          <History size={17} style={{ color: "#a78bfa" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold" style={{ color: "var(--text)" }}>記事履歴</h1>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            これまでに執筆・下書きした記事の一覧。「承認」で最新のGoogleドキュメントを取り込み、装飾＋画像付きでWordPressに投稿できます。
          </p>
        </div>
        <button onClick={load} disabled={loading} className="cyber-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} 更新
        </button>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors"
            style={filter === f.id
              ? { background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.45)", color: "#a78bfa" }
              : { background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.14)", color: "var(--text-muted)" }}>
            {f.label}
          </button>
        ))}
        <select value={mediaFilter} onChange={(e) => setMediaFilter(e.target.value)}
          className="cyber-input ml-auto px-2 py-1 rounded-lg text-[10px]">
          <option value="all">すべてのメディア</option>
          {mediaOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="free">フリー執筆</option>
        </select>
      </div>

      {error && (
        <div className="rounded-xl p-3" style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)" }}>
          <p className="text-[11px]" style={{ color: "#f87171" }}>{error}</p>
        </div>
      )}
      {notice && (
        <div className="rounded-xl p-3" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.35)" }}>
          <p className="text-[11px]" style={{ color: "#34d399" }}>✅ {notice}</p>
        </div>
      )}
      {busyId && (
        <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.3)" }}>
          <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "#38bdf8" }} />
          <p className="text-[11px]" style={{ color: "#38bdf8" }}>{busyLabel}</p>
        </div>
      )}

      {/* 一覧 */}
      <div className="glass-static rounded-xl overflow-hidden">
        {loading && rows.length === 0 ? (
          <p className="text-[11px] p-5 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={12} className="animate-spin" /> 読み込み中…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] p-5" style={{ color: "var(--text-muted)" }}>該当する記事がありません</p>
        ) : (
          filtered.map((a) => {
            const st = statusOf(a);
            const title = a.finalArticleTitle ?? a.selectedArticle ?? a.targetTheme ?? "(無題)";
            const isBusy = busyId === a.id;
            return (
              <div key={a.id} className="px-4 py-3 space-y-1.5" style={{ borderBottom: "1px solid rgba(56,189,248,0.07)" }}>
                <div className="flex items-start gap-2">
                  <p className="text-[12px] font-semibold flex-1 min-w-0 leading-relaxed" style={{ color: "var(--text)" }}>{title}</p>
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold"
                    style={{ background: `${st.color}1f`, border: `1px solid ${st.color}55`, color: st.color }}>
                    {st.label}
                  </span>
                </div>
                <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[9px]" style={{ color: "var(--text-muted)" }}>
                  <span>{new Date(a.createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" })}</span>
                  <span className="flex items-center gap-1">
                    <Globe size={9} />
                    {a.media ? a.media.name : `フリー執筆${a.clientName ? `（${a.clientName}）` : ""}`}
                  </span>
                  {a.origin === "schedule" && (
                    <span className="px-1 rounded font-bold" style={{ background: "rgba(250,204,21,0.15)", color: "#facc15" }}>自動</span>
                  )}
                  {a.targetWordCount && <span>{a.targetWordCount.toLocaleString()}字指定</span>}
                  {a.imagesGenerated && <span>画像あり</span>}
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button onClick={() => preview(a)} className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "var(--cyan)" }}>
                    <Eye size={10} /> プレビュー
                  </button>
                  {a.gdocUrl && (
                    <a href={a.gdocUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "#a78bfa" }}>
                      <FileText size={10} /> Googleドキュメント <ExternalLink size={9} />
                    </a>
                  )}
                  {a.wpEditLink && (
                    <a href={a.wpEditLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "#38bdf8" }}>
                      <PenLine size={10} /> WP編集 <ExternalLink size={9} />
                    </a>
                  )}
                  {a.wpViewLink && a.wpPublished && (
                    <a href={a.wpViewLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: "#34d399" }}>
                      <Globe size={10} /> 公開ページ <ExternalLink size={9} />
                    </a>
                  )}
                  <span className="flex-1" />
                  {a.canApprove && (
                    <button onClick={() => approve(a)} disabled={busyId !== null}
                      className="cyber-btn-primary inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40"
                      title="最新のGoogleドキュメントを取り込み、装飾＋画像付きでWordPressに下書き保存">
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      承認してWPへ反映
                    </button>
                  )}
                  {a.wpPostId && !a.wpPublished && a.media?.wpUrl && (
                    <button onClick={() => publish(a)} disabled={busyId !== null}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40"
                      style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399" }}>
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
                      WordPressで公開
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        <Sparkles size={9} className="inline mr-1" />
        「承認してWPへ反映」は、Googleドキュメント上で修正した最新の本文を取り込み、WordPress用の装飾HTMLを作り直し、アイキャッチ・本文画像を生成して下書き保存します。公開はWordPress管理画面または「WordPressで公開」から行えます。
      </p>
    </div>
  );
}
