"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";

interface MediaItem {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  audience: string | null;
  tone: string | null;
  mainCategories: string[];
  aiCompanyMediaId: string | null;
  syncStatus: string;
  syncMessage: string | null;
  _count: { workflows: number };
}

interface WorkflowStep {
  id: string;
  key: string;
  label: string;
  status: string;
  output: unknown;
  revisionNote: string | null;
}

interface ContentWorkflow {
  id: string;
  mediaId: string;
  instruction: string;
  targetTheme: string | null;
  status: string;
  currentStep: string;
  finalArticleTitle: string | null;
  finalArticle: string | null;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

const syncStyle: Record<string, React.CSSProperties> = {
  synced: { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" },
  local_only: { background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "var(--blue)" },
  failed: { background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" },
  pending: { background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" },
};

function stepColor(status: string) {
  if (status === "approved" || status === "completed") return "#34d399";
  if (status === "in_review") return "var(--blue)";
  if (status === "revision_requested") return "#fb923c";
  return "rgba(100,116,139,0.5)";
}

function outputText(output: unknown) {
  return JSON.stringify(output ?? {}, null, 2);
}

export default function MediaWorkflowPage() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [workflows, setWorkflows] = useState<ContentWorkflow[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingMedia, setCreatingMedia] = useState(false);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [acting, setActing] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  const [mediaForm, setMediaForm] = useState({
    name: "",
    domain: "",
    description: "",
    audience: "",
    tone: "",
    mainCategories: "",
  });
  const [instruction, setInstruction] = useState("");
  const [targetTheme, setTargetTheme] = useState("");

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? media[0] ?? null;
  const selectedWorkflow =
    workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0] ?? null;
  const currentStep = selectedWorkflow?.steps.find((step) => step.key === selectedWorkflow.currentStep) ?? null;

  const approvedCount = selectedWorkflow?.steps.filter((step) => step.status === "approved").length ?? 0;
  const progress = selectedWorkflow ? Math.round((approvedCount / selectedWorkflow.steps.length) * 100) : 0;
  const currentOutput = useMemo(() => outputText(currentStep?.output), [currentStep]);

  async function load() {
    setLoading(true);
    const mediaRes = await fetch("/api/media");
    const mediaData = await mediaRes.json();
    setMedia(mediaData);

    const nextMediaId = selectedMediaId || mediaData[0]?.id || "";
    setSelectedMediaId(nextMediaId);

    if (nextMediaId) {
      const workflowRes = await fetch(`/api/content-workflows?mediaId=${encodeURIComponent(nextMediaId)}`);
      const workflowData = await workflowRes.json();
      setWorkflows(workflowData);
      setSelectedWorkflowId((prev) => prev || workflowData[0]?.id || "");
    } else {
      setWorkflows([]);
      setSelectedWorkflowId("");
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshForMedia(mediaId: string) {
    setSelectedMediaId(mediaId);
    setSelectedWorkflowId("");
    const res = await fetch(`/api/content-workflows?mediaId=${encodeURIComponent(mediaId)}`);
    const data = await res.json();
    setWorkflows(data);
    setSelectedWorkflowId(data[0]?.id ?? "");
  }

  async function createMedia(e: React.FormEvent) {
    e.preventDefault();
    if (!mediaForm.name.trim() || !mediaForm.domain.trim()) return;
    setCreatingMedia(true);
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mediaForm),
      });
      const created = await res.json();
      if (!res.ok) {
        alert(created.error ?? "メディア登録に失敗しました");
        return;
      }
      setMedia((prev) => [created, ...prev]);
      setSelectedMediaId(created.id);
      setWorkflows([]);
      setSelectedWorkflowId("");
      setMediaForm({ name: "", domain: "", description: "", audience: "", tone: "", mainCategories: "" });
    } finally {
      setCreatingMedia(false);
    }
  }

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    const mediaId = selectedMedia?.id;
    if (!mediaId || !instruction.trim()) return;
    setCreatingWorkflow(true);
    try {
      const res = await fetch("/api/content-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          instruction: instruction.trim(),
          targetTheme: targetTheme.trim() || null,
        }),
      });
      const created = await res.json();
      if (!res.ok) {
        alert(created.error ?? "ワークフロー作成に失敗しました");
        return;
      }
      setWorkflows((prev) => [created, ...prev]);
      setSelectedWorkflowId(created.id);
      setInstruction("");
      setTargetTheme("");
      setRevisionNote("");
    } finally {
      setCreatingWorkflow(false);
    }
  }

  async function stepAction(action: "approve" | "reject" | "revise") {
    if (!selectedWorkflow || !currentStep) return;
    if ((action === "reject" || action === "revise") && !revisionNote.trim()) {
      alert("差戻し内容を入力してください");
      return;
    }
    setActing(true);
    try {
      const res = await fetch("/api/content-workflows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: selectedWorkflow.id,
          stepKey: currentStep.key,
          action,
          revisionNote: revisionNote.trim() || null,
        }),
      });
      const updated = await res.json();
      if (!res.ok) {
        alert(updated.error ?? "ステップ更新に失敗しました");
        return;
      }
      setWorkflows((prev) => prev.map((workflow) => (workflow.id === updated.id ? updated : workflow)));
      setSelectedWorkflowId(updated.id);
      if (action !== "reject") setRevisionNote("");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(34,211,238,0.75)" }}>MEDIA CONTENT OPS</p>
          <h1 className="text-lg font-bold" style={{ color: "var(--cyan)", textShadow: "0 0 12px rgba(34,211,238,0.5)" }}>メディア運用・記事制作</h1>
        </div>
        <button onClick={load} disabled={loading} className="cyber-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          更新
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[330px_360px_1fr] gap-4 p-4 overflow-y-auto lg:overflow-hidden">
        <div className="flex flex-col gap-4 min-h-0">
          <form onSubmit={createMedia} className="glass-static rounded-xl p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-2">
              <Globe size={13} style={{ color: "var(--cyan)" }} />
              <p className="text-xs font-bold" style={{ color: "var(--cyan)" }}>運用メディア登録</p>
            </div>
            <input value={mediaForm.name} onChange={(e) => setMediaForm((p) => ({ ...p, name: e.target.value }))} placeholder="メディア名" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <input value={mediaForm.domain} onChange={(e) => setMediaForm((p) => ({ ...p, domain: e.target.value }))} placeholder="example.com" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <textarea value={mediaForm.description} onChange={(e) => setMediaForm((p) => ({ ...p, description: e.target.value }))} rows={2} placeholder="メディア概要" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            <input value={mediaForm.audience} onChange={(e) => setMediaForm((p) => ({ ...p, audience: e.target.value }))} placeholder="想定読者" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <input value={mediaForm.tone} onChange={(e) => setMediaForm((p) => ({ ...p, tone: e.target.value }))} placeholder="文体・トーン" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <input value={mediaForm.mainCategories} onChange={(e) => setMediaForm((p) => ({ ...p, mainCategories: e.target.value }))} placeholder="カテゴリ（カンマ区切り）" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <button type="submit" disabled={creatingMedia || !mediaForm.name.trim() || !mediaForm.domain.trim()} className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {creatingMedia ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              AICompany連動で登録
            </button>
          </form>

          <div className="glass-static rounded-xl overflow-hidden flex-1 min-h-0">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>登録済みメディア</p>
            </div>
            <div className="overflow-y-auto h-full pb-10">
              {media.map((item) => (
                <button key={item.id} onClick={() => refreshForMedia(item.id)} className="w-full text-left px-4 py-3 transition-colors" style={{
                  background: selectedMedia?.id === item.id ? "rgba(34,211,238,0.06)" : "transparent",
                  borderBottom: "1px solid rgba(56,189,248,0.06)",
                }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{item.name}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={syncStyle[item.syncStatus] ?? syncStyle.pending}>
                      {item.syncStatus}
                    </span>
                  </div>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{item.domain}</p>
                  <p className="text-[9px] mt-1" style={{ color: "rgba(100,116,139,0.55)" }}>{item._count.workflows} workflows</p>
                </button>
              ))}
              {!loading && media.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>メディアを登録してください</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 min-h-0">
          <form onSubmit={createWorkflow} className="glass-static rounded-xl p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-2">
              <PenLine size={13} style={{ color: "#34d399" }} />
              <p className="text-xs font-bold" style={{ color: "#34d399" }}>記事作成指示</p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.12)" }}>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>選択中</p>
              <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{selectedMedia?.name ?? "未選択"}</p>
            </div>
            <input value={targetTheme} onChange={(e) => setTargetTheme(e.target.value)} placeholder="テーマ（任意）" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} placeholder="例: SEO初心者向けに、CVにつながる記事群を作りたい" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            <button type="submit" disabled={creatingWorkflow || !selectedMedia || !instruction.trim()} className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {creatingWorkflow ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              制作フロー開始
            </button>
          </form>

          <div className="glass-static rounded-xl overflow-hidden flex-1 min-h-0">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>制作フロー</p>
            </div>
            <div className="overflow-y-auto h-full pb-10">
              {workflows.map((workflow) => (
                <button key={workflow.id} onClick={() => { setSelectedWorkflowId(workflow.id); setRevisionNote(""); }} className="w-full text-left px-4 py-3 transition-colors" style={{
                  background: selectedWorkflow?.id === workflow.id ? "rgba(56,189,248,0.06)" : "transparent",
                  borderBottom: "1px solid rgba(56,189,248,0.06)",
                }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--text)" }}>{workflow.targetTheme || workflow.instruction}</p>
                    <ChevronRight size={12} style={{ color: stepColor(workflow.status) }} />
                  </div>
                  <p className="text-[10px] mt-1 truncate" style={{ color: "var(--text-muted)" }}>{workflow.currentStep}</p>
                </button>
              ))}
              {!loading && selectedMedia && workflows.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>記事作成指示から開始できます</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="glass-static rounded-xl overflow-hidden min-h-0 flex flex-col">
          {selectedWorkflow && currentStep ? (
            <>
              <div className="px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: stepColor(currentStep.status) }}>{currentStep.status}</p>
                    <h2 className="text-base font-bold mt-0.5" style={{ color: "var(--text)" }}>{currentStep.label}</h2>
                    <p className="text-xs mt-1 truncate" style={{ color: "var(--text-muted)" }}>{selectedWorkflow.instruction}</p>
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(56,189,248,0.1)" }}>
                      <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#34d399" }} />
                    </div>
                    <p className="text-[9px] text-right mt-1" style={{ color: "var(--text-muted)" }}>{progress}%</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {selectedWorkflow.steps.map((step) => (
                    <span key={step.key} className="text-[9px] px-2 py-1 rounded-full" style={{
                      background: step.key === currentStep.key ? "rgba(56,189,248,0.12)" : "rgba(100,116,139,0.08)",
                      border: `1px solid ${step.key === currentStep.key ? "rgba(56,189,248,0.35)" : "rgba(100,116,139,0.12)"}`,
                      color: stepColor(step.status),
                    }}>
                      {step.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto p-5">
                <pre className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-dim)" }}>
                  {currentOutput}
                </pre>
              </div>

              <div className="shrink-0 p-4 space-y-3" style={{ borderTop: "1px solid rgba(56,189,248,0.1)" }}>
                {currentStep.status === "revision_requested" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}>
                    <AlertCircle size={13} style={{ color: "#fb923c", flexShrink: 0 }} />
                    <p className="text-xs" style={{ color: "#fb923c" }}>{currentStep.revisionNote}</p>
                  </div>
                )}
                <textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={2} placeholder="差戻し・再提案の指示" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
                <div className="flex gap-2">
                  {currentStep.status === "revision_requested" ? (
                    <button onClick={() => stepAction("revise")} disabled={acting || !revisionNote.trim()} className="cyber-btn-primary flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
                      {acting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      再提案
                    </button>
                  ) : (
                    <>
                      <button onClick={() => stepAction("approve")} disabled={acting || currentStep.status !== "in_review"} className="cyber-btn-primary flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
                        {acting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                        承認して次へ
                      </button>
                      <button onClick={() => stepAction("reject")} disabled={acting || currentStep.status !== "in_review" || !revisionNote.trim()} className="cyber-btn flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
                        <XCircle size={13} />
                        差戻し
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <FileText size={38} style={{ color: "rgba(56,189,248,0.22)" }} />
              <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>メディア登録後、記事作成指示を開始できます</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
