"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Loader2, Play, RefreshCw, Plus, Check, Copy,
  Search, Users, Tag, ListTree, SlidersHorizontal, PenLine, FileSearch,
  Globe, ChevronDown, ChevronRight, Lock, Crown, ExternalLink, Code2,
  Image as ImageIcon, Eye, Rocket, MousePointerClick, FileText, Upload, Square, CalendarClock,
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
  scheduleEnabled?: boolean;
  schedulePerMonth?: number;
  scheduleWordCount?: number | null;
  scheduleInstruction?: string | null;
  scheduleLastRunAt?: string | null;
  scheduledThisMonth?: number;
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
  origin?: string;
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
  clientName: string | null;
  media: MediaItem | null;
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

function aiStepsDone(wf: Workflow) {
  return STEP_ORDER.every((k) => hasOutput(wf.steps.find((s) => s.key === k)));
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
  error: "エラー（自動停止）",
};

export default function PipelinePage() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string>("");
  // 執筆モード：media=連携メディアの記事 / free=フリー執筆（単発・クライアント依頼→Googleドキュメント納品）
  const [mode, setMode] = useState<"media" | "free">("media");
  const [freeClient, setFreeClient] = useState("");
  const [freeSite, setFreeSite] = useState("");
  const [theme, setTheme] = useState("");
  const [instruction, setInstruction] = useState("");
  const [wordCount, setWordCount] = useState("");
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
  // 作業停止用：ステップ間で停止フラグを見て中断し、実行中のリクエストはabortする
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  // 自動スケジュール設定（選択中メディアの値を編集）
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedPerMonth, setSchedPerMonth] = useState("2");
  const [schedWordCount, setSchedWordCount] = useState("");
  const [schedInstruction, setSchedInstruction] = useState("");
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    const res = await fetch("/api/media");
    if (res.ok) {
      const data = (await res.json()) as MediaItem[];
      setMedia(data);
      setSelectedMediaId((prev) => prev || data[0]?.id || "");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const url = mode === "free" ? "/api/pipeline?freeform=1" : selectedMediaId ? `/api/pipeline?mediaId=${selectedMediaId}` : null;
    if (!url) return setHistory([]);
    const res = await fetch(url);
    if (res.ok) setHistory(await res.json());
  }, [mode, selectedMediaId]);

  useEffect(() => { loadMedia(); }, [loadMedia]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // メディアを切り替えたらスケジュール設定フォームをそのメディアの保存値に同期
  useEffect(() => {
    const m = media.find((x) => x.id === selectedMediaId);
    if (!m) return;
    setSchedEnabled(Boolean(m.scheduleEnabled));
    setSchedPerMonth(String(m.schedulePerMonth ?? 2));
    setSchedWordCount(m.scheduleWordCount ? String(m.scheduleWordCount) : "");
    setSchedInstruction(m.scheduleInstruction ?? "");
    setSchedMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMediaId]);

  async function saveSchedule() {
    if (!selectedMediaId || schedSaving) return;
    setSchedSaving(true);
    setSchedMsg(null);
    try {
      const res = await fetch("/api/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: selectedMediaId,
          schedule: {
            enabled: schedEnabled,
            perMonth: Number(schedPerMonth) || 2,
            wordCount: schedWordCount ? Number(schedWordCount) : null,
            instruction: schedInstruction.trim() || null,
          },
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as MediaItem & { planLog?: string[] };
        setMedia((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
        const planLog = updated.planLog ?? [];
        setSchedMsg(
          planLog.length
            ? planLog.join(" ／ ")
            : schedEnabled ? "保存しました。予定日に自動執筆されます。" : "自動スケジュールをオフにしました。"
        );
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error ?? "スケジュール設定の保存に失敗しました");
      }
    } finally {
      setSchedSaving(false);
    }
  }
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

  // in_progress の間だけ run_next を回し、完了・停止で止まる
  async function drive(wf: Workflow) {
    let guard = 0;
    while (wf.status === "in_progress" && guard < 14) {
      if (stopRef.current) break; // 停止要求
      guard += 1;
      abortRef.current = new AbortController();
      let r: Response;
      try {
        r = await fetch("/api/pipeline", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId: wf.id, action: "run_next" }),
          signal: abortRef.current.signal,
        });
      } catch {
        break; // abort もしくは通信エラー → 停止
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        if (e?.error) setPipelineError(e.error); // AI失敗（残高不足等）を明示
        break;
      }
      wf = (await r.json()) as Workflow;
      setWorkflow(wf);
      if (stopRef.current) break;
      const active = STEP_ORDER.find((k) => !hasOutput(wf.steps.find((s) => s.key === k)));
      if (active) setExpanded(active);
    }
    // 完了したらアコーディオンは全て閉じる
    if (wf.status === "completed") setExpanded(null);
    loadHistory();
    recheckEntitlement();
    return wf;
  }

  // 作業停止：ステップ間で中断し、実行中のリクエストを打ち切る（サーバ側の現ステップは完了扱いになる場合あり）
  function stopWork() {
    stopRef.current = true;
    abortRef.current?.abort();
    setRunning(false);
  }

  // 停止したワークフローを再開
  async function resumeWork() {
    if (!workflow || running) return;
    stopRef.current = false;
    setPipelineError(null);
    setRunning(true);
    try { await drive(workflow); } finally { setRunning(false); }
  }

  async function runPipeline() {
    if (running) return;
    if (mode === "media" && !selectedMediaId) return;
    if (mode === "free" && !theme.trim()) { setPipelineError("フリー執筆はテーマ・キーワードの入力が必須です"); return; }
    stopRef.current = false;
    setPipelineError(null);
    setRunning(true);
    setWorkflow(null);
    setExpanded(null);
    try {
      const payload = mode === "free"
        ? { freeform: true, targetTheme: theme.trim(), clientName: freeClient.trim() || null, clientSite: freeSite.trim() || null, instruction: instruction.trim(), targetWordCount: wordCount ? Number(wordCount) : null }
        : { mediaId: selectedMediaId, instruction: instruction.trim(), targetTheme: theme.trim() || null, targetWordCount: wordCount ? Number(wordCount) : null };
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        if (res.status === 403) setEntitlement({ found: Boolean(e.found), entitled: false, planName: null, billingUrl: e.billingUrl ?? null });
        else if (res.status === 402) { alert(e.error ?? "今月のトークン上限に達しています"); recheckEntitlement(); }
        else setPipelineError(e.error ?? "開始に失敗しました");
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
    loadHistory();
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

  async function openWorkflow(id: string) {
    const res = await fetch(`/api/pipeline?id=${id}`);
    if (res.ok) {
      const wf = (await res.json()) as Workflow;
      setWorkflow(wf);
      // 完了済みは閉じた状態で開く。実行中(停止済み含む)は執筆ステップを開き、再開は手動
      setExpanded(wf.status === "completed" ? null : "draft_article");
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.3), rgba(34,211,238,0.3))", border: "1px solid rgba(52,211,153,0.4)" }}>
            <Sparkles size={17} style={{ color: "#34d399" }} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(52,211,153,0.75)" }}>AI WRITING PIPELINE</p>
            <h1 className="text-base md:text-lg font-bold grad-text truncate">メディア分析 → 記事執筆まで一気通貫</h1>
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

      {/* モバイルは1カラム縦積み＋ページスクロール、md以上は左固定320px＋右可変で内部スクロール */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 p-4 overflow-y-auto md:overflow-hidden">
        {/* Left: media + controls */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* 執筆モード切替 */}
          <div className="glass-static rounded-xl p-1.5 shrink-0 flex gap-1">
            {([["media", "メディア記事"], ["free", "フリー執筆"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setWorkflow(null); setExpanded(null); setPipelineError(null); }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-colors"
                style={mode === m
                  ? { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399" }
                  : { border: "1px solid transparent", color: "var(--text-muted)" }}>
                {label}
              </button>
            ))}
          </div>

          {mode === "media" ? (
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
                <div className="flex items-center gap-1.5 py-1">
                  <Globe size={11} style={{ color: selectedMedia.wpUrl ? "#34d399" : "var(--text-muted)" }} />
                  <span className="text-[10px] font-bold" style={{ color: selectedMedia.wpUrl ? "#34d399" : "var(--text-muted)" }}>
                    WordPress {selectedMedia.wpUrl ? "連携済み ✅" : "未連携"}
                  </span>
                </div>
                {selectedMedia.wpUrl ? (
                  <p className="text-[9px] break-all" style={{ color: "var(--text-muted)" }}>{selectedMedia.wpUrl}</p>
                ) : (
                  <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    対象サイトに専用プラグイン「SEO Agent Connector」を入れて有効化すると、自動で連携されます（URL・キーの入力は不要）。
                  </p>
                )}

                {/* 自動スケジュール：月n本・文字数を指定して定期的に自動執筆（完成後WPへ下書き保存） */}
                <div className="pt-2 mt-2 space-y-1.5" style={{ borderTop: "1px solid rgba(56,189,248,0.1)" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CalendarClock size={11} style={{ color: schedEnabled ? "#facc15" : "var(--text-muted)" }} />
                      <span className="text-[10px] font-bold" style={{ color: schedEnabled ? "#facc15" : "var(--text-muted)" }}>自動スケジュール</span>
                    </div>
                    <button onClick={() => setSchedEnabled((v) => !v)}
                      className="px-2 py-0.5 rounded-full text-[9px] font-bold transition-colors"
                      style={schedEnabled
                        ? { background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.45)", color: "#facc15" }
                        : { background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.16)", color: "var(--text-muted)" }}>
                      {schedEnabled ? "ON" : "OFF"}
                    </button>
                  </div>
                  {schedEnabled && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>月</span>
                        <input value={schedPerMonth} onChange={(e) => setSchedPerMonth(e.target.value.replace(/[^0-9]/g, ""))}
                          inputMode="numeric" className="cyber-input w-12 px-2 py-1 rounded-lg text-xs text-center" />
                        <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>本</span>
                        <input value={schedWordCount} onChange={(e) => setSchedWordCount(e.target.value.replace(/[^0-9]/g, ""))}
                          inputMode="numeric" placeholder="文字数 例:5000" className="cyber-input flex-1 min-w-0 px-2 py-1 rounded-lg text-xs" />
                        <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>字</span>
                      </div>
                      <input value={schedInstruction} onChange={(e) => setSchedInstruction(e.target.value)}
                        placeholder="AIへの指示（任意）例: 比較記事を優先" className="cyber-input w-full px-2 py-1 rounded-lg text-[10px]" />
                      <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        保存すると今月・来月の執筆予定（日付＋AIが提案するテーマ）が作成され、AI秘書（AICompany）のGoogleカレンダーにも登録。予定日に自動執筆→WordPressに下書き保存します。
                        今月の実績: <b style={{ color: "#facc15" }}>{selectedMedia.scheduledThisMonth ?? 0} / {Number(schedPerMonth) || 2} 本</b>
                      </p>
                    </>
                  )}
                  <button onClick={saveSchedule} disabled={schedSaving}
                    className="cyber-btn w-full py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
                    {schedSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    {schedSaving ? "保存＆予定を作成中…" : "スケジュール設定を保存"}
                  </button>
                  {schedMsg && <p className="text-[9px] leading-relaxed" style={{ color: "#34d399" }}>{schedMsg}</p>}
                  <a href="/calendar" className="block text-[9px] font-bold" style={{ color: "#fb923c" }}>
                    📅 執筆スケジュール（カレンダー）で予定を確認 →
                  </a>
                </div>
              </div>
            )}
          </div>
          ) : (
          <div className="glass-static rounded-xl p-4 shrink-0 space-y-2">
            <p className="text-xs font-bold" style={{ color: "var(--text)" }}>フリー執筆（単発・クライアント依頼）</p>
            <input value={freeClient} onChange={(e) => setFreeClient(e.target.value)} placeholder="クライアント名（任意）" className="cyber-input w-full px-3 py-2 rounded-lg text-xs" />
            <input value={freeSite} onChange={(e) => setFreeSite(e.target.value)} placeholder="掲載先サイトURL（任意・参考として分析）" className="cyber-input w-full px-3 py-2 rounded-lg text-xs" />
            <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              メディア連携なしで、指定テーマからKW調査→競合調査→構成→執筆まで一気通貫で実行します。完成記事は<b style={{ color: "#22d3ee" }}>Googleドキュメント</b>に保存されます（WordPress保存・画像生成は対象外）。
            </p>
          </div>
          )}

          <div className="glass-static rounded-xl p-4 shrink-0 space-y-3">
            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: mode === "free" ? "#34d399" : "var(--text-muted)" }}>
                {mode === "free" ? "テーマ・キーワード（必須）" : "テーマ（任意）"}
              </label>
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder={mode === "free" ? "例: 相続放棄 手続き 期限" : "例: 法人向けSaaS導入"} className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>指示（任意）</label>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder="例: CV導線に近い比較記事を優先したい" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>
            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>目標文字数（任意）</label>
              <div className="flex items-center gap-2">
                <input value={wordCount} onChange={(e) => setWordCount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="例: 5000" className="cyber-input flex-1 px-3 py-2 rounded-lg text-sm" />
                <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>字</span>
              </div>
              <div className="flex gap-1 mt-1.5">
                {[2000, 3000, 5000, 8000].map((n) => (
                  <button key={n} type="button" onClick={() => setWordCount(String(n))}
                    className="px-2 py-1 rounded-md text-[9px] font-bold transition-colors"
                    style={wordCount === String(n)
                      ? { background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399" }
                      : { background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.14)", color: "var(--text-muted)" }}>
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <p className="text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>未指定ならAIが最適な文字数を自動判断します</p>
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
                <button onClick={runPipeline} disabled={(mode === "media" ? !selectedMediaId : !theme.trim()) || running || entLoading}
                  className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-40">
                  {running || entLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {running ? "実行中…" : entLoading ? "確認中…" : "一気通貫で実行"}
                </button>
                {mode === "media" && selectedMedia && (
                  <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {selectedMedia.name}（{selectedMedia.domain}）を分析し、不足記事の特定→KW/競合調査→構成→執筆まで自動実行します。
                  </p>
                )}
                {mode === "free" && (
                  <p className="text-[9px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    テーマ「{theme.trim() || "未入力"}」でKW/競合調査→構成→執筆まで自動実行し、Googleドキュメントに保存します。
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
            {/* モバイル(縦積み)では高さが親から決まらないため上限を設ける */}
            <div className="overflow-y-auto flex-1 max-h-72 md:max-h-none">
              {history.length === 0 ? (
                <p className="text-[10px] p-4" style={{ color: "var(--text-muted)" }}>まだ実行履歴がありません</p>
              ) : history.map((h) => (
                <button key={h.id} onClick={() => openWorkflow(h.id)}
                  className="w-full text-left px-4 py-2.5 transition-colors" style={{ borderBottom: "1px solid rgba(56,189,248,0.06)", background: workflow?.id === h.id ? "rgba(56,189,248,0.06)" : "transparent" }}>
                  <p className="text-[11px] font-semibold truncate" style={{ color: "var(--text)" }}>{h.finalArticleTitle ?? h.selectedArticle ?? h.targetTheme ?? h.instruction}</p>
                  <p className="text-[9px] mt-0.5 flex items-center gap-1.5" style={{ color: h.status === "completed" ? "#34d399" : h.status.startsWith("awaiting") ? "#facc15" : "var(--text-muted)" }}>
                    {h.origin === "schedule" && (
                      <span className="px-1 rounded font-bold" style={{ background: "rgba(250,204,21,0.15)", color: "#facc15" }}>自動</span>
                    )}
                    {HISTORY_STATUS[h.status] ?? h.status}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: pipeline steps + article */}
        <div className="min-h-0 overflow-y-auto pr-1">
          {pipelineError && (
            <div className="rounded-xl p-3 mb-3 flex items-start gap-2" style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)" }}>
              <Lock size={14} className="shrink-0 mt-0.5" style={{ color: "#f87171" }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold" style={{ color: "#f87171" }}>生成を停止しました</p>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--text)" }}>{pipelineError}</p>
              </div>
              <button onClick={() => setPipelineError(null)} className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>×</button>
            </div>
          )}
          {!workflow ? (
            <FlowOverview canRun={Boolean(entitlement?.entitled)} />
          ) : (
            <div className="space-y-3">
              {/* 生成中は進捗を上部に。完了バナーは一番下に置く（上→下の流れの最後にする） */}
              {workflow.status !== "completed" && (
                <StatusBanner workflow={workflow} running={running} onWp={wpAction} onReject={rejectDraft} onCancel={cancelWorkflow} onStop={stopWork} onResume={resumeWork} />
              )}

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

              <ProductionSteps workflow={workflow} running={running} />

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

              {/* 完了バナー＋操作（プレビュー/公開/再執筆/削除）は最下部 */}
              {workflow.status === "completed" && (
                <StatusBanner workflow={workflow} running={running} onWp={wpAction} onReject={rejectDraft} onCancel={cancelWorkflow} onStop={stopWork} onResume={resumeWork} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 実行前：初めから制作までの流れ ──
const FLOW_STAGES: {
  no: string; title: string; color: string;
  steps: { icon: typeof Search; label: string; note?: string }[];
}[] = [
  {
    no: "1", title: "メディア分析・調査", color: "#34d399",
    steps: [
      { icon: FileSearch, label: "メディア分析", note: "サイトを解析し不足記事を特定" },
      { icon: Search, label: "記事キーワード調査" },
      { icon: Users, label: "競合調査" },
      { icon: Tag, label: "勝てるテールKW洗い出し" },
      { icon: Users, label: "テールKWで競合調査" },
    ],
  },
  {
    no: "2", title: "構成・執筆", color: "#fb923c",
    steps: [
      { icon: ListTree, label: "勝てる記事構成の設計" },
      { icon: SlidersHorizontal, label: "文字数・内部/外部リンク要件" },
      { icon: PenLine, label: "AIが記事を執筆", note: "Googleドキュメントにも保存" },
      { icon: Code2, label: "WordPress装飾HTML整形", note: "吹き出し・表・マーカー等をインラインCSSで" },
    ],
  },
  {
    no: "3", title: "画像・入稿・公開", color: "#f472b6",
    steps: [
      { icon: ImageIcon, label: "画像生成プロンプト付与" },
      { icon: Sparkles, label: "画像を自動生成・挿入", note: "gpt-image-1" },
      { icon: Globe, label: "WordPressに下書き保存" },
      { icon: Rocket, label: "内容を確認して公開", note: "ワンクリック" },
    ],
  },
];

function FlowOverview({ canRun }: { canRun: boolean }) {
  return (
    <div className="glass-static rounded-xl h-full flex flex-col p-6 overflow-y-auto">
      <div className="text-center shrink-0">
        <div className="inline-flex w-12 h-12 rounded-xl items-center justify-center mb-3"
          style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.25), rgba(34,211,238,0.25))", border: "1px solid rgba(52,211,153,0.4)" }}>
          <Sparkles size={22} style={{ color: "#34d399" }} />
        </div>
        <p className="text-lg font-bold" style={{ color: "var(--text)" }}>メディア分析 → 記事制作 → 公開までの流れ</p>
        <p className="text-xs mt-1.5 max-w-xl mx-auto leading-relaxed" style={{ color: "var(--text-muted)" }}>
          左でメディアを選んで<b style={{ color: "#34d399" }}>「一気通貫で実行」</b>を押すと、以下の工程をAIが最後まで自動で進めます。
        </p>
      </div>

      {/* 起点 */}
      <div className="mt-5 flex items-center justify-center gap-2 shrink-0">
        <div className="flex items-center gap-2 rounded-full px-4 py-2" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)" }}>
          <MousePointerClick size={14} style={{ color: "var(--cyan)" }} />
          <span className="text-[11px] font-bold" style={{ color: "var(--text)" }}>メディアを選択して実行</span>
        </div>
      </div>

      <div className="flex justify-center py-1 shrink-0">
        <ChevronDown size={16} style={{ color: "rgba(52,211,153,0.5)" }} />
      </div>

      {/* 3ステージ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
        {FLOW_STAGES.map((stage, si) => (
          <div key={stage.no} className="contents">
            <div className="rounded-xl p-3.5 flex flex-col" style={{ background: `${stage.color}0d`, border: `1px solid ${stage.color}33` }}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                  style={{ background: stage.color, color: "#0a0e14" }}>{stage.no}</span>
                <p className="text-[12px] font-bold" style={{ color: stage.color }}>{stage.title}</p>
              </div>
              <div className="space-y-1.5 flex-1">
                {stage.steps.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-lg px-2.5 py-2"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${stage.color}1a`, border: `1px solid ${stage.color}40` }}>
                        <Icon size={12} style={{ color: stage.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold leading-tight" style={{ color: "var(--text)" }}>{step.label}</p>
                        {step.note && <p className="text-[9px] mt-0.5 leading-tight" style={{ color: "var(--text-muted)" }}>{step.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {si < FLOW_STAGES.length - 1 && (
              <div className="hidden lg:flex items-center justify-center">
                <ChevronRight size={20} style={{ color: "rgba(52,211,153,0.4)" }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 完了 */}
      <div className="flex justify-center py-1 shrink-0">
        <ChevronDown size={16} style={{ color: "rgba(52,211,153,0.5)" }} />
      </div>
      <div className="flex items-center justify-center gap-2 shrink-0">
        <div className="flex items-center gap-2 rounded-full px-4 py-2" style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.35)" }}>
          <Check size={14} style={{ color: "#34d399" }} />
          <span className="text-[11px] font-bold" style={{ color: "#34d399" }}>画像付き記事がWordPressに入稿・公開</span>
        </div>
      </div>

      <p className="text-center text-[10px] mt-4 shrink-0" style={{ color: "var(--text-muted)" }}>
        {canRun
          ? "各工程は完了後に個別で修正・再生成もできます。プレビューで見た目を確認してから公開できます。"
          : "※ 一気通貫の自動生成はAICompanyの有料プラン契約者のみご利用いただけます。"}
      </p>
    </div>
  );
}

// ── 入稿・公開フェーズ（AIステップの後段。workflowの状態フィールドに連動）──
type PhaseState = "done" | "active" | "pending" | "skip";

function ProductionSteps({ workflow, running }: { workflow: Workflow; running: boolean }) {
  const freeform = !workflow.media; // フリー執筆（Googleドキュメント納品）
  const wpConnected = Boolean(workflow.media?.wpUrl);
  const aiDone = aiStepsDone(workflow);
  const wpSaved = Boolean(workflow.wpPostId);
  const published = workflow.wpPublished;
  const draftDone = hasOutput(workflow.steps.find((s) => s.key === "draft_article"));
  // 最終run_next（WP保存＋画像生成）が実行中
  const wpActive = running && aiDone && wpConnected && !wpSaved;

  const phases: {
    key: string; icon: typeof Search; color: string; label: string;
    state: PhaseState; note: string; link?: string | null;
  }[] = [
    {
      key: "gdoc", icon: FileText, color: "#22d3ee", label: "Googleドキュメントに保存",
      state: workflow.gdocId ? "done" : draftDone ? "skip" : "pending",
      note: workflow.gdocId ? (freeform ? "納品ドキュメント保存済み" : "保存済み") : "記事執筆の完了時に自動保存",
      link: workflow.gdocUrl,
    },
    {
      key: "images", icon: ImageIcon, color: "#f472b6", label: "画像を自動生成・挿入",
      state: wpSaved ? "done" : wpActive ? "active" : wpConnected ? "pending" : "skip",
      note: wpSaved ? (workflow.imagesGenerated ? "gpt-image-1で生成・挿入済み" : "挿入対象の画像コメントなし")
        : wpConnected ? "gpt-image-1で自動生成し記事に挿入"
        : freeform ? "フリー執筆は対象外（画像生成プロンプトを活用）" : "WordPress未接続のためスキップ",
    },
    {
      key: "wp_draft", icon: Upload, color: "#a78bfa", label: "WordPressに下書き保存",
      state: wpSaved ? "done" : wpActive ? "active" : wpConnected ? "pending" : "skip",
      note: wpConnected ? (wpSaved ? "下書き保存済み" : "装飾HTMLを自動で下書き保存")
        : freeform ? "フリー執筆は対象外（Googleドキュメント納品）" : "WordPress未接続（プラグインで連携）",
      link: wpSaved ? workflow.wpEditLink : null,
    },
    {
      key: "publish", icon: Rocket, color: "#34d399", label: "WordPressに公開",
      state: published ? "done" : freeform ? "skip" : "pending",
      note: published ? "公開済み" : freeform ? "フリー執筆は対象外" : wpSaved ? "内容を確認して「公開する」で実行" : "下書き保存後に公開できます",
      link: published ? workflow.wpViewLink : null,
    },
  ];

  const stateText: Record<PhaseState, string> = { done: "完了", active: "処理中…", pending: "待機", skip: "スキップ" };

  return (
    <div className="glass-static rounded-xl overflow-hidden">
      <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <p className="text-[10px] font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>画像生成・WordPress入稿・公開</p>
      </div>
      <div className="divide-y" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
        {phases.map((p) => {
          const Icon = p.icon;
          const dim = p.state === "pending" || p.state === "skip";
          return (
            <div key={p.key} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: dim ? "rgba(255,255,255,0.03)" : `${p.color}1a`, border: `1px solid ${dim ? "rgba(255,255,255,0.08)" : `${p.color}44`}` }}>
                {p.state === "active" ? <Loader2 size={14} className="animate-spin" style={{ color: p.color }} />
                  : p.state === "done" ? <Check size={14} style={{ color: p.color }} />
                  : <Icon size={14} style={{ color: dim ? "var(--text-muted)" : p.color }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color: dim ? "var(--text-muted)" : "var(--text)" }}>{p.label}</p>
                <p className="text-[9px] mt-0.5" style={{ color: p.state === "active" ? p.color : "var(--text-muted)" }}>{p.note}</p>
              </div>
              {p.link && (
                <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold shrink-0 flex items-center gap-0.5" style={{ color: "var(--cyan)" }}>
                  開く <ExternalLink size={10} />
                </a>
              )}
              <span className="text-[9px] font-bold shrink-0" style={{ color: p.state === "done" ? p.color : p.state === "active" ? p.color : "var(--text-muted)" }}>
                {stateText[p.state]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 段階実行：通知＋人間アクション ──
function StatusBanner({ workflow, running, onWp, onReject, onCancel, onStop, onResume }: {
  workflow: Workflow; running: boolean;
  onWp: (a: "wp_draft" | "wp_publish") => void;
  onReject: () => void; onCancel: () => void;
  onStop: () => void; onResume: () => void;
}) {
  const s = workflow.status;

  if (s === "in_progress") {
    return (
      <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: running ? "rgba(56,189,248,0.08)" : "rgba(251,146,60,0.08)", border: `1px solid ${running ? "rgba(56,189,248,0.25)" : "rgba(251,146,60,0.3)"}` }}>
        {running ? <Loader2 size={15} className="animate-spin shrink-0" style={{ color: "var(--blue)" }} /> : <Square size={14} className="shrink-0" style={{ color: "#fb923c" }} />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold" style={{ color: running ? "var(--blue)" : "#fb923c" }}>{running ? "AIが自動生成中…" : "作業を停止しました"}</p>
          <p className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            {running ? "分析→執筆→画像生成→WordPress下書き保存まで自動で進みます（1〜3分）" : "途中まで生成済みです。「再開」で続きから実行、または削除できます。"}
          </p>
        </div>
        {running ? (
          <button onClick={onStop} className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
            style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.45)", color: "#f87171" }}>
            <Square size={12} /> 作業停止
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-2">
            <button onClick={onResume} className="cyber-btn-primary px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
              <Play size={12} /> 再開
            </button>
            <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "rgba(248,113,113,0.85)" }}>
              削除
            </button>
          </div>
        )}
      </div>
    );
  }

  if (s === "completed") {
    const freeform = !workflow.media;
    const wpConnected = Boolean(workflow.media?.wpUrl);
    const saved = Boolean(workflow.wpPostId);
    const swellHtml = ((workflow.steps.find((st) => st.key === "swell_format")?.output ?? {}) as { html?: string }).html ?? "";
    const previewHtml = workflow.finalHtml || swellHtml;
    return (
      <div className="rounded-xl p-4" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)" }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Check size={16} style={{ color: "#34d399" }} />
          <p className="text-xs font-bold" style={{ color: "#34d399" }}>
            {workflow.wpPublished ? "✅ WordPressに公開しました"
              : saved ? "✅ WordPress下書き保存完了"
              : freeform ? "🎉 記事が完成しました（Googleドキュメントに納品済み）" : "🎉 記事が完成しました"}
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
            {freeform
              ? "Googleドキュメントを開いて納品できます。「プレビュー」やHTMLソースのコピーから任意のCMSにも貼り付け可能です。"
              : "WordPressに自動保存するには、対象サイトに「SEO Agent Connector」プラグインを入れて有効化してください（自動連携）。"}
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
