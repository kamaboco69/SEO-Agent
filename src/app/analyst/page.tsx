"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Clipboard,
  FileJson,
  FolderOpen,
  Inbox,
  Loader2,
  Newspaper,
  RefreshCw,
  Send,
} from "lucide-react";

interface ProjectOption {
  id: string;
  name: string;
  domain: string | null;
  _count: { keywords: number; articles: number };
}

interface AnalystHandoff {
  id: string;
  title: string;
  objective: string;
  targetDomain: string | null;
  status: string;
  priority: string;
  payload: unknown;
  analystNotes: string | null;
  recommendation: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string; domain: string | null } | null;
}

interface AiCompanyMedia {
  name: string;
  url: string;
  description?: string | null;
}

interface AiCompanyProfile {
  email: string;
  name: string | null;
  providers: string[];
  aiCompany: {
    aiCompanyId: string;
    displayName: string | null;
    defaultDomain: string | null;
    defaultProjectName: string | null;
    defaultObjective: string | null;
    defaultContext: string | null;
    settings?: { media?: AiCompanyMedia[] } | null;
  } | null;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const deliverables = [
  "SEO優先課題の整理",
  "キーワード戦略の改善案",
  "コンテンツ改善提案",
  "次の2週間で実行すべきアクション",
];

function statusStyle(status: string): React.CSSProperties {
  if (status === "reviewed") {
    return { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" };
  }
  if (status === "sent") {
    return { background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", color: "var(--purple)" };
  }
  return { background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", color: "var(--blue)" };
}

export default function AnalystPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [handoffs, setHandoffs] = useState<AnalystHandoff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("AICompany SEO分析依頼");
  const [objective, setObjective] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [priority, setPriority] = useState("normal");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiProfile, setAiProfile] = useState<AiCompanyProfile | null>(null);

  const selected = handoffs.find((handoff) => handoff.id === selectedId) ?? handoffs[0] ?? null;
  const payloadText = useMemo(() => (selected ? JSON.stringify(selected.payload, null, 2) : ""), [selected]);
  const media = aiProfile?.aiCompany?.settings?.media ?? [];

  async function load() {
    setLoading(true);
    const [projectRes, handoffRes] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/analyst/handoffs"),
    ]);
    const [projectData, handoffData] = await Promise.all([
      projectRes.json(),
      handoffRes.json(),
    ]);
    setProjects(projectData);
    setHandoffs(handoffData);
    setSelectedId((prev) => prev ?? handoffData[0]?.id ?? null);

    const profileRes = await fetch("/api/ai-company/profile");
    if (profileRes.ok) {
      const profile = await profileRes.json() as AiCompanyProfile;
      setAiProfile(profile);
      if (profile.aiCompany) {
        setTargetDomain((prev) => prev || profile.aiCompany?.defaultDomain || "");
        setObjective((prev) => prev || profile.aiCompany?.defaultObjective || "");
        setContextNotes((prev) => prev || profile.aiCompany?.defaultContext || "");
        setTitle((prev) =>
          prev === "AICompany SEO分析依頼" && profile.aiCompany?.defaultProjectName
            ? `${profile.aiCompany.defaultProjectName} SEO分析依頼`
            : prev
        );
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function createHandoff(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !objective.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/analyst/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId || null,
          title: title.trim(),
          objective: objective.trim(),
          targetDomain: targetDomain.trim() || null,
          contextNotes: contextNotes.trim() || null,
          priority,
          requestedDeliverables: deliverables,
        }),
      });
      const created = await res.json();
      if (!res.ok) {
        alert(created.error ?? "ハンドオフ作成に失敗しました");
        return;
      }
      setHandoffs((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setObjective("");
      setContextNotes("");
    } finally {
      setCreating(false);
    }
  }

  async function copyPayload() {
    if (!payloadText) return;
    await navigator.clipboard.writeText(payloadText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="shrink-0 px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "rgba(52,211,153,0.75)" }}>AICompany CONNECTOR</p>
          <h1 className="text-lg font-bold" style={{ color: "#34d399", textShadow: "0 0 12px rgba(52,211,153,0.5)" }}>SEOアナリスト連携</h1>
        </div>
        <button onClick={load} disabled={loading} className="cyber-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          更新
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[340px_1fr] gap-4 p-4 overflow-hidden">
        <div className="flex flex-col gap-4 min-h-0">
          <form onSubmit={createHandoff} className="glass-static rounded-xl p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <Send size={13} style={{ color: "#34d399" }} />
              <p className="text-xs font-bold" style={{ color: "#34d399" }}>ハンドオフ作成</p>
            </div>

            {aiProfile?.aiCompany && (
              <div className="rounded-lg px-3 py-2" style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <p className="text-[9px] font-bold tracking-wider" style={{ color: "#34d399" }}>AICompany設定を自動反映中</p>
                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                  {aiProfile.aiCompany.displayName ?? aiProfile.email} / {aiProfile.aiCompany.aiCompanyId}
                </p>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>PROJECT</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="cyber-input w-full px-3 py-2 rounded-lg text-sm">
                <option value="">プロジェクト未指定</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}{project.domain ? ` / ${project.domain}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>TITLE</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>

            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>TARGET DOMAIN</label>
              <input value={targetDomain} onChange={(e) => setTargetDomain(e.target.value)} placeholder="未入力ならプロジェクトのドメイン" className="cyber-input w-full px-3 py-2 rounded-lg text-sm" />
            </div>

            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>OBJECTIVE</label>
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={3} placeholder="例: 主要KWの順位改善とコンテンツ優先順位を決めたい" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>

            <div>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>CONTEXT</label>
              <textarea value={contextNotes} onChange={(e) => setContextNotes(e.target.value)} rows={2} placeholder="補足メモ、制約、競合など" className="cyber-input w-full px-3 py-2 rounded-lg text-sm resize-none" />
            </div>

            <div className="flex gap-2">
              {(["normal", "high", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className="flex-1 text-[10px] px-2 py-1.5 rounded-lg font-bold transition-all"
                  style={priority === p
                    ? { background: "rgba(52,211,153,0.18)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399" }
                    : { background: "transparent", border: "1px solid rgba(56,189,248,0.12)", color: "var(--text-muted)" }}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>

            <button type="submit" disabled={creating || !title.trim() || !objective.trim()} className="cyber-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              AICompany用パッケージ生成
            </button>
          </form>

          {aiProfile?.aiCompany && (
            <div className="glass-static rounded-xl p-4 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Newspaper size={13} style={{ color: "var(--cyan)" }} />
                <p className="text-xs font-bold" style={{ color: "var(--text)" }}>AICompanyメディア</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(56,189,248,0.1)", color: "var(--cyan)" }}>
                  {media.length}
                </span>
              </div>
              {media.length === 0 ? (
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  AICompany側にメディアが登録されていません。AICompanyでメディアを登録すると、ここに自動表示されます。
                </p>
              ) : (
                <div className="space-y-1.5">
                  {media.map((m, i) => (
                    <button
                      key={`${m.url}-${i}`}
                      type="button"
                      onClick={() => setTargetDomain(hostFromUrl(m.url))}
                      title="クリックでTARGET DOMAINに設定"
                      className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
                      style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.14)" }}
                    >
                      <p className="text-[11px] font-semibold truncate" style={{ color: "var(--text)" }}>{m.name}</p>
                      <p className="text-[9px] truncate" style={{ color: "var(--cyan)" }}>{m.url}</p>
                      {m.description && (
                        <p className="text-[9px] mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>{m.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="glass-static rounded-xl overflow-hidden flex-1 min-h-0">
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
              <Inbox size={13} style={{ color: "var(--blue)" }} />
              <p className="text-xs font-bold" style={{ color: "var(--text)" }}>連携履歴</p>
            </div>
            <div className="overflow-y-auto h-full pb-12">
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={22} className="animate-spin" style={{ color: "var(--blue)" }} />
                </div>
              ) : handoffs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-5 text-center">
                  <FolderOpen size={28} style={{ color: "rgba(56,189,248,0.25)" }} />
                  <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>まだハンドオフがありません</p>
                </div>
              ) : (
                handoffs.map((handoff) => (
                  <button
                    key={handoff.id}
                    onClick={() => setSelectedId(handoff.id)}
                    className="w-full text-left px-4 py-3 transition-colors"
                    style={{
                      borderBottom: "1px solid rgba(56,189,248,0.06)",
                      background: selected?.id === handoff.id ? "rgba(56,189,248,0.06)" : "transparent",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--text)" }}>{handoff.title}</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={statusStyle(handoff.status)}>
                        {handoff.status}
                      </span>
                    </div>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                      {handoff.project?.name ?? handoff.targetDomain ?? "project未指定"}
                    </p>
                    <p className="text-[9px] mt-1" style={{ color: "rgba(100,116,139,0.55)" }}>
                      更新: {new Date(handoff.updatedAt).toLocaleString("ja")}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-rows-[auto_1fr] gap-4 min-h-0">
          {selected ? (
            <>
              <div className="glass-static rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={statusStyle(selected.status)}>{selected.status}</span>
                      <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{selected.priority.toUpperCase()}</span>
                    </div>
                    <h2 className="text-base font-bold truncate" style={{ color: "var(--text)" }}>{selected.title}</h2>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>{selected.objective}</p>
                  </div>
                  <button onClick={copyPayload} className="cyber-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold shrink-0">
                    {copied ? <Check size={13} /> : <Clipboard size={13} />}
                    {copied ? "コピー済み" : "JSONコピー"}
                  </button>
                </div>

                {selected.recommendation ? (
                  <div className="mt-4 rounded-xl p-4" style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)" }}>
                    <p className="text-[10px] font-bold mb-2" style={{ color: "#34d399" }}>AICompany SEOアナリスト提案</p>
                    {selected.analystNotes && <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--text-muted)" }}>{selected.analystNotes}</p>}
                    <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text)" }}>{selected.recommendation}</p>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.2)" }}>
                    <AlertCircle size={13} style={{ color: "#fb923c", flexShrink: 0 }} />
                    <p className="text-xs" style={{ color: "#fb923c" }}>提案受信待ちです。受信API: <code>/api/analyst/recommendations</code></p>
                  </div>
                )}
              </div>

              <div className="glass-static rounded-xl overflow-hidden min-h-0 flex flex-col">
                <div className="px-4 py-3 flex items-center gap-2 shrink-0" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
                  <FileJson size={13} style={{ color: "var(--cyan)" }} />
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>連携ペイロード</p>
                </div>
                <pre className="flex-1 overflow-auto p-4 text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
                  {payloadText}
                </pre>
              </div>
            </>
          ) : (
            <div className="glass-static rounded-xl flex flex-col items-center justify-center">
              <FileJson size={34} style={{ color: "rgba(56,189,248,0.25)" }} />
              <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>ハンドオフを選択してください</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
