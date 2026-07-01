"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, Loader2, Play, RefreshCw, Plus, Check, Copy,
  Search, Users, Tag, ListTree, SlidersHorizontal, PenLine, FileSearch,
  Globe, ChevronDown, Lock, Crown, ExternalLink, Code2, Image as ImageIcon, Eye,
} from "lucide-react";

interface Entitlement {
  found: boolean;
  entitled: boolean;
  planName: string | null;
  billingUrl: string | null;
  usage?: { usedTokens: number; limit: number; allowed: boolean } | null;
}

interface MediaItem {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  syncStatus: string;
  aiCompanyMediaId: string | null;
  wpUrl?: string | null;
  wpConnectedAt?: string | null;
  _count?: { workflows: number };
}

interface Step {
  key: string;
  label: string;
  status: string;
  output: Record<string, unknown>;
  revisionNote: string | null;
}

interface Workflow {
  id: string;
  instruction: string;
  targetTheme: string | null;
  status: string;
  currentStep: string;
  selectedArticle: string | null;
  approved1: boolean;
  approved2: boolean;
  finalArticle: string | null;
  finalArticleTitle: string | null;
  wpPostId: number | null;
  wpEditLink: string | null;
  wpViewLink: string | null;
  wpPublished: boolean;
  imagesGenerated: boolean;
  finalHtml: string | null;
  gdocId: string | null;
  gdocUrl: string | null;
  media: MediaItem;
  steps: Step[];
}

const STEP_META: Record<string, { icon: typeof Search; color: string; short: string }> = {
  media_analysis:           { icon: FileSearch,        color: "#34d399", short: "メディア分析・不足記事" },
  keyword_research:         { icon: Search,            color: "#22d3ee", short: "記事KW調査" },
  competitor_research:      { icon: Users,             color: "#a78bfa", short: "競合調査" },
  tail_keywords:            { icon: Tag,               color: "#f472b6", short: "勝てるテールKW" },
  tail_competitor_research: { icon: Users,             color: "#c084fc", short: "テールKW競合調査" },
  article_outline:          { icon: ListTree,          color: "#fb923c", short: "記事構成" },
  seo_requirements:         { icon: SlidersHorizontal, color: "#facc15", short: "SEO要件" },
  draft_article:            { icon: PenLine,           color: "#34d399", short: "記事執筆" },
  swell_format:             { icon: Code2,             color: "#38bdf8", short: "WordPress装飾HTML整形" },
  image_prompts:            { icon: ImageIcon,         color: "#f472b6", short: "画像プロンプト" },
};

const STEP_ORDER = [
  "media_analysis", "keyword_research", "competitor_research",
  "tail_keywords", "tail_competitor_research", "article_outline",
  "seo_requirements", "draft_article", "swell_format", "image_prompts",
];

function hasOutput(step?: Step) {
  return Boolean(step && step.output && Object.keys(step.output).length > 0);
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

const HISTORY_STATUS: Record<string, string> = {
  in_progress: "生成中",
  awaiting_selection: "記事選択待ち",
  awaiting_approval_1: "承認待ち(執筆)",
  awaiting_approval_2: "承認待ち(公開前)",
  completed: "完了",
};

export default function PipelinePage() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string>("");
  const [theme, setTheme] = useState("");
  const [instruction, setInstruction] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [running, setRunning] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [history, setHistory] = useState<Workflow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseNote, setReviseNote] = useState("");
  const [showAddMedia, setShowAddMedia] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [copied, setCopied] = useState(false);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [entLoading, setEntLoading] = useState(true);
  const [showWp, setShowWp] = useState(false);
  const [wpUrl, setWpUrl] = useState("");
  const [wpSecret, setWpSecret] = useState("");
  const [wpSaving, setWpSaving] = useState(false);
  const [wpMsg, setWpMsg] = useState("");

  const loadMedia = useCallback(async () => {
    const res = await fetch("/api/media");
    if (res.ok) {
      const data = (await res.json()) as MediaItem[];
      setMedia(data);
      setSelectedMediaId((prev) => prev || data[0]?.id || "");
    }
  }, []);

  const loadHistory = useCallback(async (mediaId: string) => {
    if (!mediaId) return setHistory([]);
    const res = await fetch(`/api/pipeline?mediaId=${mediaId}`);
    if (res.ok) setHistory(await res.json());
  }, []);

  useEffect(() => { loadMedia(); }, [loadMedia]);
  useEffect(() => { loadHistory(selectedMediaId); }, [selectedMediaId, loadHistory]);
  useEffect(() => {
    fetch("/api/ai-company/entitlement")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEntitlement(d))
      .catch(() => setEntitlement(null))
      .finally(() => setEntLoading(false));
  }, []);

  async function recheckEntitlement() {
    setEntLoading(true);
    try {
      const r = await fetch("/api/ai-company/entitlement");
      if (r.ok) setEntitlement(await r.json());
    } finally {
      setEntLoading(false);
    }
  }

  async function syncMedia() {
    setSyncing(true);
    try {
      const res = await fetch("/api/media/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMedia(data.media);
        setSelectedMediaId((prev) => prev || data.media[0]?.id || "");
        if (data.total === 0) alert("AICompany側にメディアが登録されていません。AICompanyでメディアを登録してください。");
      } else {
        alert(data.error ?? "同期に失敗しました");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function addMedia() {
    if (!newName.trim() || !newDomain.trim()) return;
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), domain: newDomain.trim() }),
    });
    if (res.ok) {
      const created = await res.json();
      setNewName(""); setNewDomain(""); setShowAddMedia(false);
      await loadMedia();
      setSelectedMediaId(created.id);
    } else {
      alert("メディア追加に失敗しました");
    }
  }

  // in_progress の間だけ run_next を回し、ゲート(選択/承認)や完了で停止する
  async function drive(wf: Workflow) {
    let guard = 0;
    while (wf.status === "in_progress" && guard < 14) {
      guard += 1;
      const r = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: wf.id, action: "run_next" }),
      });
      if (!r.ok) break;
      wf = (await r.json()) as Workflow;
      setWorkflow(wf);
      const active = STEP_ORDER.find((k) => !hasOutput(wf.steps.find((s) => s.key === k)));
      if (active) setExpanded(active);
    }
    loadHistory(selectedMediaId);
    recheckEntitlement();
    return wf;
  }

  async function runPipeline() {
    if (!selectedMediaId || running) return;
    setRunning(true);
    setWorkflow(null);
    setExpanded(null);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: selectedMediaId, instruction: instruction.trim(), targetTheme: theme.trim() || null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        if (res.status === 403) setEntitlement({ found: Boolean(e.found), entitled: false, planName: null, billingUrl: e.billingUrl ?? null });
        else if (res.status === 402) { alert(e.error ?? "今月のトークン上限に達しています"); recheckEntitlement(); }
        else alert(e.error ?? "開始に失敗しました");
        return;
      }
      const wf = (await res.json()) as Workflow;
      setWorkflow(wf);
      setExpanded("media_analysis");
      await drive(wf); // 選択ゲートなし → そのまま執筆まで自動実行
    } finally {
      setRunning(false);
    }
  }


  async function rejectDraft() {
    if (!workflow || running) return;
    const note = window.prompt("差戻し（再執筆）。修正の指示があれば入力してください（任意）") ?? "";
    setRunning(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: workflow.id, action: "revise", stepKey: "draft_article", revisionNote: note || null }),
      });
      if (r.ok) { setWorkflow(await r.json()); setExpanded("draft_article"); }
    } finally { setRunning(false); }
  }

  async function cancelWorkflow() {
    if (!workflow) return;
    if (!confirm("このワークフローを取り消しますか？（生成内容は破棄されます）")) return;
    await fetch(`/api/pipeline?id=${workflow.id}`, { method: "DELETE" });
    setWorkflow(null);
    setExpanded(null);
    loadHistory(selectedMediaId);
  }

  async function wpAction(action: "wp_draft" | "wp_publish") {
    if (!workflow || running) return;
    setRunning(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: workflow.id, action }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setWorkflow(d as Workflow);
      else alert(d.error ?? "WordPress操作に失敗しました");
    } finally { setRunning(false); }
  }

  async function saveWpConnection() {
    if (!selectedMediaId || !wpUrl.trim() || !wpSecret.trim()) return;
    setWpSaving(true); setWpMsg("");
    try {
      const r = await fetch("/api/media/wp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: selectedMediaId, wpUrl: wpUrl.trim(), wpSecret: wpSecret.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { setWpMsg(`✅ 接続成功${d.site ? `: ${d.site}` : ""}`); setWpSecret(""); await loadMedia(); }
      else setWpMsg(`❌ ${d.error ?? "接続に失敗しました"}`);
    } finally { setWpSaving(false); }
  }

  async function openWorkflow(id: string) {
    const res = await fetch(`/api/pipeline?id=${id}`);
    if (res.ok) {
      const wf = (await res.json()) as Workflow;
      setWorkflow(wf);
      setExpanded("draft_article");
      if (wf.status === "in_progress" && !running) {
        setRunning(true);
        try { await drive(wf); } finally { setRunning(false); }
      }
    }
  }

  async function reviseStep(key: string) {
    if (!workflow) return;
    setReviseFor(null);
    setRunning(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: workflow.id, action: "revise", stepKey: key, revisionNote: reviseNote.trim() || null }),
      });
      if (r.ok) { setWorkflow(await r.json()); setExpanded(key); }
      setReviseNote("");
    } finally {
      setRunning(false);
    }
  }

  const selectedMedia = media.find((m) => m.id === selectedMediaId) ?? null;
  const finalArticle = workflow?.finalArticle ?? null;

  async function copyArticle() {
    if (!finalArticle) return;
    await navigator.clipboard.writeText(finalArticle);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const progress = useMemo(() => {
    if (!workflow) return 0;
    const done = STEP_ORDER.filter((k) => hasOutput(workflow.steps.find((s) => s.key === k))).length;
    return Math.round((done / STEP_ORDER.length) * 100);
  }, [workflow]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.3), rgba(34,211,238,0.3))", border: "1px solid rgba(52,211,153,0.4)" }}>
            <Sparkles size={17} style={{ color: "#34d399" }} />
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(52,211,153,0.75)" }}>AI WRITING PIPELINE</p>
            <h1 className="text-lg font-bold grad-text">メディア分析 → 記事執筆まで一気通貫</h1>
          </div>
        </div>
        {workflow && (
          <div className="flex items-center gap-3">
            <div className="w-40 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.12)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#34d399,#22d3ee)" }} />
            </div>
            <span className="text-xs font-bold" style={{ color: "#34d399" }}>{progress}%</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr] gap-4 p-4 overflow-hidden">
        {/* Left: media + controls */}
        <div className="flex flex-col gap-4 min-h-0">
          <div className="glass-static rounded-xl p-4 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>対象メディア</p>
              <div className="flex gap-1.5">
                <button onClick={syncMedia} disabled={syncing} title="AICompanyから同期" className="cyber-btn flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold disabled:opacity-40">
                  {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  同期
                </button>
                <button onClick={() => setShowAddMedia((v) => !v)} title="手動追加" className="cyber-btn flex items-center px-2 py-1 rounded-lg text-[10px] font-bold">
                  <Plus size={12} />
                </button>
              </div>
            </div>

            {showAddMedia && (
              <div className="space-y-1.5 rounded-lg p-2" style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.14)" }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="メディア名" className="cyber-input w-full px-2 py-1.5 rounded-lg text-xs" />
                <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" className="cyber-input w-full px-2 py-1.5 rounded-lg text-xs" />
                <button onClick={addMedia} className="cyber-btn-primary w-full py-1.5 rounded-lg text-[10px] font-bold">追加</button>
              </div>
            )}

            {media.length === 0 ? (
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                メディアがありません。「同期」でAICompanyから取り込むか、「＋」で手動追加してください。
              </p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {media.map((m) => (
                  <button key={m.id} onClick={() => setSelectedMediaId(m.id)}
                    className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
                    style={selectedMediaId === m.id
                      ? { background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.35)" }
                      : { background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.12)" }}>
                    <div className="flex items-center gap-1.5">
                      <Globe size={11} style={{ color: selectedMediaId === m.id ? "#34d399" : "var(--text-muted)" }} />
                      <p className="text-[11px] font-semibold truncate flex-1" style={{ color: "var(--text)" }}>{m.name}</p>
                      {m.aiCompanyMediaId && <span className="text-[8px] px-1 rounded" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>AIC</span>}
                    </div>
                    <p className="text-[9px] truncate mt-0.5" style={{ color: "var(--cyan)" }}>{m.domain}</p>
                  </button>
                ))}
              </div>
            )}

            {selectedMedia && (
              <div className="pt-2" style={{ borderTop: "1px solid rgba(56,189,248,0.1)" }}>
                <button onClick={() => { setShowWp((v) => !v); setWpUrl(selectedMedia.wpUrl ?? ""); setWpMsg(""); }}
                  className="w-full flex items-center justify-between text-[10px] font-bold py-1" style={{ color: "var(--text-muted)" }}>
                  <span className="flex items-center gap-1.5">
                    <Globe size={11} style={{ color: selectedMedia.wpUrl ? "#34d399" : "var(--text-muted)" }} />
                    WordPress接続 {selectedMedia.wpUrl ? "✅" : "（未接続）"}
                  </span>
                  <ChevronDown size={12} style={{ transform: showWp ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                </button>
                {showWp && (
                  <div className="space-y-1.5 mt-1.5">
                    {selectedMedia.wpUrl && (
                      <p className="text-[9px]" style={{ color: "#34d399" }}>接続済み: {selectedMedia.wpUrl}（変更する場合のみ再入力）</p>
                    )}
                    <input value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} placeholder="https://example.com" className="cyber-input w-full px-2 py-1.5 rounded-lg text-[10px]" />
                    <input value={wpSecret} onChange={(e) => setWpSecret(e.target.value)} placeholder="接続シークレット（mu-pluginのSEO_AGENT_SECRET）" className="cyber-input w-full px-2 py-1.5 rounded-lg text-[10px]" />
                    <button onClick={saveWpConnection} disabled={wpSaving || !wpUrl.trim() || !wpSecret.trim()}
                      className="cyber-btn-primary w-full py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40">
                      {wpSaving ? "テスト中…" : "接続テストして保存"}
                    </button>
                    {wpMsg && <p className="text-[9px] leading-relaxed" style={{ color: wpMsg.startsWith("✅") ? "#34d399" : "#f87171" }}>{wpMsg}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="glass-static rounded-xl p-4 shrink-0 space-y-3">
            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>テーマ（任意）</label>
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: 法人向けSaaS導入" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>指示（任意）</label>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder="例: CV導線に近い比較記事を優先したい" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>
            {entitlement && !entitlement.entitled ? (
              <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.3)" }}>
                <div className="flex items-center gap-1.5">
                  <Lock size={12} style={{ color: "#facc15" }} />
                  <p className="text-[11px] font-bold" style={{ color: "#facc15" }}>有料プラン限定機能</p>
                </div>
                <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {entitlement.found
                    ? "一気通貫の自動生成はAICompanyの有料プラン契約者のみご利用いただけます。"
                    : "ご利用にはAICompanyアカウントとの連携＋有料プラン契約が必要です。"}
                </p>
                {entitlement.billingUrl ? (
                  <a href={entitlement.billingUrl} target="_blank" rel="noopener noreferrer"
                    className="cyber-btn-primary w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold">
                    <Crown size={13} /> AICompanyを有効にする <ExternalLink size={11} />
                  </a>
                ) : (
                  <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>AICompanyの課金画面から契約してください。</p>
                )}
                <button onClick={recheckEntitlement} disabled={entLoading}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40"
                  style={{ background: "transparent", border: "1px solid rgba(250,204,21,0.3)", color: "#facc15" }}>
                  {entLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  契約後にこちらを再確認
                </button>
              </div>
            ) : (
              <>
                <button onClick={runPipeline} disabled={!selectedMediaId || running || entLoading}
                  className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-40">
                  {running || entLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {running ? "実行中…" : entLoading ? "確認中…" : "一気通貫で実行"}
                </button>
                {selectedMedia && (
                  <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {selectedMedia.name}（{selectedMedia.domain}）を分析し、不足記事の特定→KW/競合調査→構成→執筆まで自動実行します。
                  </p>
                )}
                {entitlement?.usage && entitlement.usage.limit > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[9px]" style={{ color: "var(--text-muted)" }}>
                      <span>今月のトークン使用量（AICompany）</span>
                      <span>{entitlement.usage.usedTokens.toLocaleString()} / {entitlement.usage.limit.toLocaleString()}</span>
                    </div>
                    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.12)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((entitlement.usage.usedTokens / entitlement.usage.limit) * 100))}%`, background: entitlement.usage.allowed ? "linear-gradient(90deg,#34d399,#22d3ee)" : "#f87171" }} />
                    </div>
                  </div>
                )}
                {entitlement?.usage && entitlement.usage.limit === 0 && (
                  <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>今月のトークン: 上限なし（{entitlement.usage.usedTokens.toLocaleString()} 使用）</p>
                )}
              </>
            )}
          </div>

          <div className="glass-static rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>実行履歴</p>
            </div>
            <div className="overflow-y-auto flex-1">
              {history.length === 0 ? (
                <p className="text-[10px] p-4" style={{ color: "var(--text-muted)" }}>まだ実行履歴がありません</p>
              ) : history.map((h) => (
                <button key={h.id} onClick={() => openWorkflow(h.id)}
                  className="w-full text-left px-4 py-2.5 transition-colors" style={{ borderBottom: "1px solid rgba(56,189,248,0.06)", background: workflow?.id === h.id ? "rgba(56,189,248,0.06)" : "transparent" }}>
                  <p className="text-[11px] font-semibold truncate" style={{ color: "var(--text)" }}>{h.finalArticleTitle ?? h.selectedArticle ?? h.targetTheme ?? h.instruction}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: h.status === "completed" ? "#34d399" : h.status.startsWith("awaiting") ? "#facc15" : "var(--text-muted)" }}>{HISTORY_STATUS[h.status] ?? h.status}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: pipeline steps + article */}
        <div className="min-h-0 overflow-y-auto pr-1">
          {!workflow ? (
            <div className="glass-static rounded-xl h-full flex flex-col items-center justify-center text-center px-8">
              <Sparkles size={40} style={{ color: "rgba(52,211,153,0.3)" }} />
              <p className="text-base font-bold mt-4" style={{ color: "var(--text)" }}>メディアを選んで「一気通貫で実行」</p>
              <p className="text-xs mt-2 max-w-md leading-relaxed" style={{ color: "var(--text-muted)" }}>
                メディア分析で不足している記事を特定し、KW調査・競合調査・構成設計・SEO要件・記事執筆までをAIが連続実行します。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <StatusBanner workflow={workflow} running={running} onWp={wpAction} onReject={rejectDraft} onCancel={cancelWorkflow} />

              {STEP_ORDER.map((key) => {
                const step = workflow.steps.find((s) => s.key === key);
                const meta = STEP_META[key];
                const Icon = meta.icon;
                const done = hasOutput(step);
                const nextPending = STEP_ORDER.find((k) => !hasOutput(workflow.steps.find((s) => s.key === k)));
                const active = !done && running && nextPending === key;
                const isOpen = expanded === key;
                return (
                  <div key={key} className="glass-static rounded-xl overflow-hidden" style={{ border: active ? `1px solid ${meta.color}55` : undefined }}>
                    <button onClick={() => setExpanded(isOpen ? null : key)} className="w-full flex items-center gap-3 px-4 py-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${meta.color}1a`, border: `1px solid ${meta.color}44` }}>
                        {active ? <Loader2 size={14} className="animate-spin" style={{ color: meta.color }} /> : done ? <Check size={14} style={{ color: meta.color }} /> : <Icon size={14} style={{ color: meta.color }} />}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: done || active ? "var(--text)" : "var(--text-muted)" }}>{step?.label ?? meta.short}</p>
                        <p className="text-[9px]" style={{ color: active ? meta.color : "var(--text-muted)" }}>{active ? "生成中…" : done ? "完了" : "待機"}</p>
                      </div>
                      {done && <ChevronDown size={14} style={{ color: "var(--text-muted)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />}
                    </button>
                    {isOpen && done && step && (
                      <div className="px-4 pb-4" style={{ borderTop: "1px solid rgba(56,189,248,0.08)" }}>
                        <div className="pt-3">
                          <StepOutput stepKey={key} output={step.output} />
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          {reviseFor === key ? (
                            <>
                              <input autoFocus value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} placeholder="修正指示（例: もっと比較記事寄りに）" className="cyber-input flex-1 px-2 py-1.5 rounded-lg text-[11px]" />
                              <button onClick={() => reviseStep(key)} disabled={running} className="cyber-btn-primary px-3 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40">再生成</button>
                              <button onClick={() => { setReviseFor(null); setReviseNote(""); }} className="text-[10px]" style={{ color: "var(--text-muted)" }}>取消</button>
                            </>
                          ) : (
                            <button onClick={() => { setReviseFor(key); setReviseNote(""); }} className="cyber-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold">
                              <RefreshCw size={11} /> このステップを修正再生成
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {finalArticle && (
                <div className="glass-static rounded-xl overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                    <div className="flex items-center gap-2">
                      <PenLine size={14} style={{ color: "#34d399" }} />
                      <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{workflow.finalArticleTitle ?? "完成記事"}</p>
                    </div>
                    <button onClick={copyArticle} className="cyber-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold">
                      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "コピー済み" : "Markdownコピー"}
                    </button>
                  </div>
                  <pre className="p-4 text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)", fontFamily: "inherit", maxHeight: "60vh", overflow: "auto" }}>{finalArticle}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 段階実行：通知＋人間アクション ──
function StatusBanner({ workflow, running, onWp, onReject, onCancel }: {
  workflow: Workflow; running: boolean;
  onWp: (a: "wp_draft" | "wp_publish") => void;
  onReject: () => void; onCancel: () => void;
}) {
  const s = workflow.status;

  if (s === "in_progress") {
    return (
      <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)" }}>
        <Loader2 size={15} className="animate-spin" style={{ color: "var(--blue)" }} />
        <div>
          <p className="text-xs font-bold" style={{ color: "var(--blue)" }}>AIが自動生成中…</p>
          <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>分析→執筆→画像生成→WordPress下書き保存まで自動で進みます（1〜3分）</p>
        </div>
      </div>
    );
  }

  if (s === "completed") {
    const wpConnected = Boolean(workflow.media.wpUrl);
    const saved = Boolean(workflow.wpPostId);
    const swellHtml = ((workflow.steps.find((st) => st.key === "swell_format")?.output ?? {}) as { html?: string }).html ?? "";
    const previewHtml = workflow.finalHtml || swellHtml;
    return (
      <div className="rounded-xl p-4" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)" }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Check size={16} style={{ color: "#34d399" }} />
          <p className="text-xs font-bold" style={{ color: "#34d399" }}>
            {workflow.wpPublished ? "✅ WordPressに公開しました"
              : saved ? "✅ WordPress下書き保存完了" : "🎉 記事が完成しました"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2.5">
          {workflow.gdocUrl && (
            <a href={workflow.gdocUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold" style={{ color: "var(--cyan)" }}>📄 Googleドキュメント ↗</a>
          )}
          {saved && workflow.wpEditLink && (
            <a href={workflow.wpEditLink} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold" style={{ color: "var(--cyan)" }}>📝 WordPress編集 ↗</a>
          )}
          {workflow.wpPublished && workflow.wpViewLink && (
            <a href={workflow.wpViewLink} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold" style={{ color: "#34d399" }}>🌐 公開ページ ↗</a>
          )}
          {saved && workflow.imagesGenerated && (
            <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>画像を生成・挿入済み</span>
          )}
        </div>

        {!wpConnected && (
          <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
            WordPressに自動保存するには、左の「WordPress接続」を設定してください。
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {previewHtml && (
            <button onClick={() => openPreview(previewHtml, workflow.finalArticleTitle ?? "プレビュー")} className="cyber-btn-primary px-4 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
              <Eye size={13} /> プレビュー
            </button>
          )}
          {wpConnected && !saved && (
            <button disabled={running} onClick={() => onWp("wp_draft")} className="px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
              style={{ background: "rgba(167,139,250,0.18)", border: "1px solid rgba(167,139,250,0.45)", color: "#a78bfa" }}>
              {running ? <><Loader2 size={12} className="animate-spin inline" /> 保存中…</> : "WordPress下書き保存（画像生成）"}
            </button>
          )}
          {saved && !workflow.wpPublished && (
            <button disabled={running} onClick={() => onWp("wp_publish")} className="cyber-btn-primary px-4 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40">
              {running ? <Loader2 size={12} className="animate-spin" /> : "公開する"}
            </button>
          )}
          <button disabled={running} onClick={onReject} className="px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
            style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.4)", color: "#fb923c" }}>
            記事を再執筆
          </button>
          <button disabled={running} onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
            style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "rgba(248,113,113,0.85)" }}>
            削除
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── ステップ出力の表示 ──
function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${color}1a`, color, border: `1px solid ${color}44` }}>{children}</span>;
}

function KwRow({ k }: { k: { keyword: string; volume?: number; difficulty?: number; intent?: string } }) {
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: "1px solid rgba(56,189,248,0.06)" }}>
      <span className="text-[11px] flex-1 truncate" style={{ color: "var(--text)" }}>{k.keyword}</span>
      {typeof k.volume === "number" && <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>vol {k.volume}</span>}
      {typeof k.difficulty === "number" && <span className="text-[9px]" style={{ color: k.difficulty > 60 ? "#fb923c" : "#34d399" }}>難 {k.difficulty}</span>}
      {k.intent && <Pill color="#22d3ee">{k.intent}</Pill>}
    </div>
  );
}

function StepOutput({ stepKey, output }: { stepKey: string; output: Record<string, unknown> }) {
  const o = output;
  const muted = { color: "var(--text-muted)" };
  const txt = { color: "var(--text)" };

  if (stepKey === "media_analysis") {
    const gaps = (o.contentGaps as { title: string; intent: string; reason: string }[]) ?? [];
    return (
      <div className="space-y-3">
        {o.summary != null && <p className="text-[11px] leading-relaxed" style={txt}>{String(o.summary)}</p>}
        <div>
          <p className="text-[10px] font-bold mb-1.5" style={muted}>不足している記事</p>
          <div className="space-y-1.5">
            {gaps.map((g, i) => (
              <div key={i} className="rounded-lg px-2.5 py-2" style={{ background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.12)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold flex-1" style={txt}>{g.title}</span>
                  <Pill color="#a78bfa">{g.intent}</Pill>
                </div>
                {g.reason && <p className="text-[9px] mt-0.5" style={muted}>{g.reason}</p>}
              </div>
            ))}
          </div>
        </div>
        {o.recommendedArticle != null && (
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)" }}>
            <p className="text-[9px] font-bold" style={{ color: "#34d399" }}>最優先で書く記事</p>
            <p className="text-[12px] font-semibold mt-0.5" style={txt}>{String(o.recommendedArticle)}</p>
            {o.rationale != null && <p className="text-[9px] mt-1" style={muted}>{String(o.rationale)}</p>}
          </div>
        )}
      </div>
    );
  }

  if (stepKey === "keyword_research" || stepKey === "tail_keywords") {
    const list = ((o.candidates as { keyword: string }[]) ?? (o.tailKeywords as { keyword: string }[]) ?? []);
    const primary = (o.primaryKeyword ?? o.parentKeyword) as string | undefined;
    return (
      <div className="space-y-2">
        {primary && <div className="flex items-center gap-2"><span className="text-[10px]" style={muted}>主軸KW:</span><Pill color="#34d399">{primary}</Pill></div>}
        <div>{list.map((k, i) => <KwRow key={i} k={k} />)}</div>
        {o.selectedReason != null && <p className="text-[9px]" style={muted}>{String(o.selectedReason)}</p>}
        {o.recommendedUse != null && <p className="text-[9px]" style={muted}>{String(o.recommendedUse)}</p>}
      </div>
    );
  }

  if (stepKey === "competitor_research" || stepKey === "tail_competitor_research") {
    const patterns = (o.competitorPatterns as { pattern: string; strength: string; gap: string }[]) ?? [];
    const diff = (o.differentiation as string[]) ?? [];
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          {patterns.map((p, i) => (
            <div key={i} className="rounded-lg px-2.5 py-2" style={{ background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.18)" }}>
              <p className="text-[11px] font-semibold" style={txt}>{p.pattern}</p>
              <p className="text-[9px] mt-0.5" style={{ color: "#34d399" }}>強み: {p.strength}</p>
              <p className="text-[9px]" style={{ color: "#fb923c" }}>抜け: {p.gap}</p>
            </div>
          ))}
        </div>
        {diff.length > 0 && (
          <div>
            <p className="text-[10px] font-bold mb-1" style={muted}>差別化方針</p>
            <ul className="space-y-1">{diff.map((d, i) => <li key={i} className="text-[10px] flex gap-1.5" style={txt}><span style={{ color: "#34d399" }}>▸</span>{d}</li>)}</ul>
          </div>
        )}
      </div>
    );
  }

  if (stepKey === "article_outline") {
    const outline = (o.outline as { h2: string; h3: string[] }[]) ?? [];
    return (
      <div className="space-y-2">
        {o.title != null && <p className="text-[12px] font-bold" style={txt}>{String(o.title)}</p>}
        {o.metaDescription != null && <p className="text-[9px]" style={muted}>{String(o.metaDescription)}</p>}
        <div className="space-y-1.5 mt-1">
          {outline.map((s, i) => (
            <div key={i}>
              <p className="text-[11px] font-semibold" style={{ color: "#fb923c" }}>H2: {s.h2}</p>
              {Array.isArray(s.h3) && <p className="text-[9px] ml-3" style={muted}>{s.h3.join(" / ")}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (stepKey === "seo_requirements") {
    const wc = o.targetWordCount as { min?: number; recommended?: number; max?: number } | undefined;
    const internal = (o.internalLinks as { anchor: string; target: string; reason: string }[]) ?? [];
    return (
      <div className="space-y-2">
        {wc && <p className="text-[11px]" style={txt}>目標文字数: <b style={{ color: "#facc15" }}>{wc.recommended}</b> 字（{wc.min}〜{wc.max}）</p>}
        {Array.isArray(o.keywordPlacement) && <p className="text-[10px]" style={muted}>KW配置: {(o.keywordPlacement as string[]).join(" / ")}</p>}
        {internal.length > 0 && (
          <div>
            <p className="text-[10px] font-bold mb-1" style={muted}>内部リンク</p>
            {internal.map((l, i) => <p key={i} className="text-[10px]" style={txt}>・{l.anchor} → <span style={{ color: "var(--cyan)" }}>{l.target}</span> <span style={muted}>({l.reason})</span></p>)}
          </div>
        )}
        {o.cta != null && <p className="text-[10px]" style={muted}>CTA: {String(o.cta)}</p>}
      </div>
    );
  }

  if (stepKey === "swell_format") {
    const html = (o.html as string) ?? "";
    const comments = (o.imageComments as string[]) ?? [];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {o.title != null && <p className="text-[12px] font-bold" style={txt}>{String(o.title)}</p>}
          {html && (
            <button onClick={() => openPreview(html, String(o.title ?? "プレビュー"))} className="cyber-btn flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0">
              <Eye size={11} /> プレビュー
            </button>
          )}
        </div>
        {comments.length > 0 && (
          <p className="text-[9px]" style={muted}>画像挿入コメント: {comments.length}箇所</p>
        )}
        <div className="rounded-lg p-3 bg-white text-black overflow-auto" style={{ maxHeight: "45vh" }} dangerouslySetInnerHTML={{ __html: html }} />
        <details>
          <summary className="text-[9px] cursor-pointer" style={muted}>HTMLソースを表示</summary>
          <pre className="text-[10px] leading-relaxed whitespace-pre-wrap mt-1" style={{ color: "var(--text-dim)", fontFamily: "inherit", maxHeight: "30vh", overflow: "auto" }}>{html}</pre>
        </details>
      </div>
    );
  }

  if (stepKey === "image_prompts") {
    const images = (o.images as { index: number; comment: string; prompt: string }[]) ?? [];
    return (
      <div className="space-y-1.5">
        {images.map((im, i) => (
          <div key={i} className="rounded-lg px-2.5 py-2" style={{ background: "rgba(244,114,182,0.05)", border: "1px solid rgba(244,114,182,0.2)" }}>
            <p className="text-[10px] font-semibold" style={{ color: "#f472b6" }}>#{im.index + 1} {im.comment}</p>
            <p className="text-[10px] mt-0.5" style={txt}>{im.prompt}</p>
          </div>
        ))}
      </div>
    );
  }

  // draft_article: 本文プレビュー
  const body = (o.body as string) ?? "";
  return (
    <div>
      {o.title != null && <p className="text-[12px] font-bold mb-2" style={txt}>{String(o.title)}</p>}
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-dim)", fontFamily: "inherit", maxHeight: "40vh", overflow: "auto" }}>{body.slice(0, 1200)}{body.length > 1200 ? "…（全文は下の完成記事で）" : ""}</pre>
    </div>
  );
}
