"use client";

import { useState, useCallback, useRef } from "react";
import { Sparkles, Loader2, RefreshCw, CheckCircle, XCircle, AlertCircle, FileText, Target, ChevronRight } from "lucide-react";

interface SeoCheck { label: string; ok: boolean; tip: string; }
interface SeoScore { score: number; checks: SeoCheck[]; wordCount: number; kwCount: number; density: number; }

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#34d399" : score >= 40 ? "#fb923c" : "#f87171";
  const glow = score >= 70 ? "rgba(52,211,153,0.4)" : score >= 40 ? "rgba(251,146,60,0.4)" : "rgba(248,113,113,0.4)";
  return (
    <div className="w-20 h-20 rounded-full flex flex-col items-center justify-center"
      style={{ background: `radial-gradient(circle, ${glow.replace("0.4", "0.1")} 0%, transparent 70%)`, border: `2px solid ${color}`, boxShadow: `0 0 20px ${glow}` }}>
      <span className="text-2xl font-bold" style={{ color }}>{score}</span>
      <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>/ 100</span>
    </div>
  );
}

export default function EditorPage() {
  const [title, setTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [targetKw, setTargetKw] = useState("");
  const [content, setContent] = useState("");
  const [scoring, setScoring] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggestingMeta, setSuggestingMeta] = useState(false);
  const [seoScore, setSeoScore] = useState<SeoScore | null>(null);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const calcScore = useCallback(async (c: string, kw: string, t: string, m: string) => {
    if (!kw) return;
    setScoring(true);
    const res = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "score", content: c, targetKw: kw, title: t, metaDesc: m }) });
    setSeoScore(await res.json());
    setScoring(false);
  }, []);

  function handleContentChange(val: string) {
    setContent(val);
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    scoreTimer.current = setTimeout(() => calcScore(val, targetKw, title, metaDesc), 1200);
  }

  async function generateContent() {
    if (!targetKw) { alert("ターゲットキーワードを入力してください"); return; }
    setGenerating(true); setContent("");
    try {
      const res = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", targetKw }) });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); alert(d.error ?? "生成に失敗しました"); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let full = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; full += decoder.decode(value, { stream: true }); setContent(full); }
      await calcScore(full, targetKw, title, metaDesc);
    } finally { setGenerating(false); }
  }

  async function suggestMeta() {
    if (!targetKw) { alert("ターゲットキーワードを入力してください"); return; }
    setSuggestingMeta(true);
    const res = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "suggest_meta", targetKw }) });
    const d = await res.json();
    setTitle(d.title ?? ""); setMetaDesc(d.metaDesc ?? "");
    setSuggestingMeta(false);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(52,211,153,0.7)" }}>CONTENT ENGINE</p>
          <h1 className="text-lg font-bold" style={{ color: "#34d399", textShadow: "0 0 12px rgba(52,211,153,0.5)" }}>AIコンテンツエディタ</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={suggestMeta} disabled={suggestingMeta || !targetKw}
            className="cyber-btn flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
            {suggestingMeta ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            AIでタイトル・メタ生成
          </button>
          <button onClick={generateContent} disabled={generating || !targetKw}
            className="cyber-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {generating ? "生成中…" : "AI記事生成"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex gap-4 p-4">
        {/* Editor */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto">
          {/* Meta fields */}
          <div className="glass-static rounded-xl p-4 space-y-3 shrink-0">
            <div>
              <label className="block text-[10px] font-bold tracking-wider mb-1.5" style={{ color: "rgba(52,211,153,0.8)" }}>
                KEYWORD TARGET <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input value={targetKw} onChange={(e) => setTargetKw(e.target.value)} placeholder="例: コンテンツSEO"
                className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>
            <div>
              <label className="flex items-center justify-between text-[10px] font-bold tracking-wider mb-1.5">
                <span style={{ color: "rgba(56,189,248,0.8)" }}>SEO TITLE</span>
                <span className="font-normal" style={{ color: title.length > 60 ? "#f87171" : "var(--text-muted)" }}>{title.length}/60字</span>
              </label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="記事タイトルを入力"
                className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>
            <div>
              <label className="flex items-center justify-between text-[10px] font-bold tracking-wider mb-1.5">
                <span style={{ color: "rgba(56,189,248,0.8)" }}>META DESCRIPTION</span>
                <span className="font-normal" style={{ color: metaDesc.length > 160 ? "#f87171" : "var(--text-muted)" }}>{metaDesc.length}/160字</span>
              </label>
              <textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} rows={2} placeholder="検索結果に表示されるページの説明文"
                className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>
          </div>

          {/* Content textarea */}
          <div className="glass-static rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
              <FileText size={13} style={{ color: "var(--text-muted)" }} />
              <span className="text-xs font-bold" style={{ color: "var(--text)" }}>本文エディタ</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>({content.replace(/<[^>]+>/g, "").length.toLocaleString()}字)</span>
            </div>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={`記事本文を入力してください。\n\nHTMLタグも使用可能です（<h2>, <h3>, <p>, <a href="...">, <img alt="..."> など）\n\nまたは「AI記事生成」ボタンでClaudeに自動作成させることもできます。`}
              className="flex-1 w-full px-4 py-3 text-sm focus:outline-none resize-none font-mono leading-relaxed"
              style={{ background: "transparent", color: "var(--text)", caretColor: "var(--blue)" }}
            />
          </div>
        </div>

        {/* SEO Score sidebar */}
        <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
          <div className="glass-static rounded-xl p-4 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>SEO SCORE</p>
              <button onClick={() => calcScore(content, targetKw, title, metaDesc)} disabled={scoring || !targetKw}
                className="transition-colors disabled:opacity-40" style={{ color: "var(--text-muted)" }}>
                <RefreshCw size={13} className={scoring ? "animate-spin" : ""} />
              </button>
            </div>

            {seoScore ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <ScoreRing score={seoScore.score} />
                  <div className="space-y-0.5">
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>文字数: <span style={{ color: "var(--text)" }}>{seoScore.wordCount.toLocaleString()}</span></p>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>KW出現: <span style={{ color: "var(--text)" }}>{seoScore.kwCount}回</span></p>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>KW密度: <span style={{ color: seoScore.density >= 0.5 && seoScore.density <= 3 ? "#34d399" : "#f87171" }}>{seoScore.density.toFixed(1)}%</span></p>
                  </div>
                </div>
                <div className="space-y-2">
                  {seoScore.checks.map((c, i) => (
                    <div key={i}>
                      <div className="flex items-start gap-2">
                        {c.ok
                          ? <CheckCircle size={12} className="shrink-0 mt-0.5" style={{ color: "#34d399" }} />
                          : <XCircle size={12} className="shrink-0 mt-0.5" style={{ color: "#f87171" }} />
                        }
                        <span className="text-[10px] leading-relaxed" style={{ color: c.ok ? "var(--text-muted)" : "var(--text-dim)" }}>{c.label}</span>
                      </div>
                      {!c.ok && (
                        <div className="ml-5 mt-0.5 flex items-start gap-1">
                          <ChevronRight size={9} className="shrink-0 mt-0.5" style={{ color: "#fb923c" }} />
                          <p className="text-[9px] leading-relaxed" style={{ color: "#fb923c" }}>{c.tip}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <Target size={26} className="mx-auto mb-2" style={{ color: "rgba(56,189,248,0.2)" }} />
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {targetKw ? "本文を入力するとSEOスコアを自動計算します" : "ターゲットキーワードを入力してください"}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl p-4" style={{ background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.2)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertCircle size={12} style={{ color: "#fb923c" }} />
              <p className="text-[10px] font-bold" style={{ color: "#fb923c" }}>執筆のポイント</p>
            </div>
            <ul className="text-[10px] space-y-1 leading-relaxed" style={{ color: "rgba(251,146,60,0.8)" }}>
              <li>• タイトルの先頭にKWを入れる</li>
              <li>• KW密度は0.5〜3%が理想</li>
              <li>• H2見出しを3〜8個で構成する</li>
              <li>• 内部リンクを2本以上設置する</li>
              <li>• FAQセクションでPAA対策する</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
