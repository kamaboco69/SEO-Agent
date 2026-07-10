"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, Loader2, Check, Globe,
  ExternalLink, X, PenLine, Clock, CheckCircle2,
} from "lucide-react";

interface MediaItem {
  id: string;
  name: string;
  domain: string;
  wpUrl?: string | null;
  scheduleEnabled?: boolean;
  schedulePerMonth?: number;
  scheduleWordCount?: number | null;
  scheduleInstruction?: string | null;
  scheduledThisMonth?: number;
}

interface PlanWorkflow {
  status: string;
  finalArticleTitle: string | null;
  wpEditLink: string | null;
  wpViewLink: string | null;
  gdocUrl: string | null;
}

interface PlanEntry {
  id: string;
  mediaId: string;
  mediaName: string;
  mediaDomain: string;
  date: string; // YYYY-MM-DD (JST)
  theme: string;
  status: string; // planned / generating / done / failed
  calendarSynced: boolean;
  workflow: PlanWorkflow | null;
}

const MEDIA_COLORS = ["#34d399", "#22d3ee", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#38bdf8", "#4ade80"];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

interface SchedForm {
  enabled: boolean;
  perMonth: string;
  wordCount: string;
  instruction: string;
}

export default function CalendarPage() {
  const today = jstToday();
  const [cursor, setCursor] = useState<{ y: number; m: number }>(() => {
    const t = new Date(Date.now() + 9 * 3600 * 1000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
  });
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<Record<string, SchedForm>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  const monthKey = `${cursor.y}-${String(cursor.m).padStart(2, "0")}`;

  const loadMedia = useCallback(async () => {
    const res = await fetch("/api/media");
    if (!res.ok) return;
    const data = (await res.json()) as MediaItem[];
    setMedia(data);
    setForms((prev) => {
      const next = { ...prev };
      for (const m of data) {
        if (!next[m.id]) {
          next[m.id] = {
            enabled: Boolean(m.scheduleEnabled),
            perMonth: String(m.schedulePerMonth ?? 2),
            wordCount: m.scheduleWordCount ? String(m.scheduleWordCount) : "",
            instruction: m.scheduleInstruction ?? "",
          };
        }
      }
      return next;
    });
  }, []);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule/plan?month=${monthKey}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => { loadMedia(); }, [loadMedia]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  function colorOf(mediaId: string) {
    const idx = media.findIndex((m) => m.id === mediaId);
    return MEDIA_COLORS[(idx >= 0 ? idx : 0) % MEDIA_COLORS.length];
  }

  async function save(mediaId: string) {
    const f = forms[mediaId];
    if (!f || saving) return;
    setSaving(mediaId);
    setMsg((p) => ({ ...p, [mediaId]: "" }));
    try {
      const res = await fetch("/api/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          schedule: {
            enabled: f.enabled,
            perMonth: Number(f.perMonth) || 2,
            wordCount: f.wordCount ? Number(f.wordCount) : null,
            instruction: f.instruction.trim() || null,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const planLog: string[] = data.planLog ?? [];
        setMsg((p) => ({ ...p, [mediaId]: planLog.length ? planLog.join(" ／ ") : "保存しました" }));
        await Promise.all([loadMedia(), loadPlan()]);
      } else {
        setMsg((p) => ({ ...p, [mediaId]: data.error ?? "保存に失敗しました" }));
      }
    } finally {
      setSaving(null);
    }
  }

  async function removeEntry(entry: PlanEntry) {
    if (!confirm(`予定「${entry.theme}」を取り消しますか？（AI秘書のカレンダーからも削除されます）`)) return;
    const res = await fetch(`/api/schedule/plan?id=${entry.id}`, { method: "DELETE" });
    if (res.ok) loadPlan();
    else alert("削除に失敗しました");
  }

  function moveMonth(delta: number) {
    setCursor((c) => {
      const m = c.m + delta;
      if (m < 1) return { y: c.y - 1, m: 12 };
      if (m > 12) return { y: c.y + 1, m: 1 };
      return { y: c.y, m };
    });
  }

  // 月グリッド（日曜始まり）
  const firstWeekday = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).getUTCDay();
  const dim = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dim }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, PlanEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  const scheduledMedia = media.filter((m) => m.scheduleEnabled);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.35)" }}>
          <CalendarDays size={17} style={{ color: "#fb923c" }} />
        </div>
        <div>
          <h1 className="text-base font-bold" style={{ color: "var(--text)" }}>執筆スケジュール</h1>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            メディアごとに月あたりの本数・文字数を設定すると、AIが日付とテーマを自動で計画し、予定日に自動執筆します。予定はAI秘書（AICompany）のGoogleカレンダーにも登録されます。
          </p>
        </div>
      </div>

      {/* メディアごとの設定 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {media.map((m) => {
          const f = forms[m.id];
          if (!f) return null;
          const color = colorOf(m.id);
          return (
            <div key={m.id} className="glass-static rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                <p className="text-xs font-bold truncate flex-1" style={{ color: "var(--text)" }}>{m.name}</p>
                <button onClick={() => setForms((p) => ({ ...p, [m.id]: { ...f, enabled: !f.enabled } }))}
                  className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                  style={f.enabled
                    ? { background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.45)", color: "#facc15" }
                    : { background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.16)", color: "var(--text-muted)" }}>
                  {f.enabled ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                <Globe size={10} style={{ color: m.wpUrl ? "#34d399" : "var(--text-muted)" }} />
                <span className="truncate">{m.domain}</span>
                <span className="shrink-0" style={{ color: m.wpUrl ? "#34d399" : "#fb923c" }}>
                  {m.wpUrl ? "WP連携済み" : "WP未連携（下書き保存なし）"}
                </span>
              </div>
              {f.enabled && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>月</span>
                    <input value={f.perMonth} onChange={(e) => setForms((p) => ({ ...p, [m.id]: { ...f, perMonth: e.target.value.replace(/[^0-9]/g, "") } }))}
                      inputMode="numeric" className="cyber-input w-12 px-2 py-1 rounded-lg text-xs text-center" />
                    <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>本</span>
                    <input value={f.wordCount} onChange={(e) => setForms((p) => ({ ...p, [m.id]: { ...f, wordCount: e.target.value.replace(/[^0-9]/g, "") } }))}
                      inputMode="numeric" placeholder="文字数 例:5000" className="cyber-input flex-1 min-w-0 px-2 py-1 rounded-lg text-xs" />
                    <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>字</span>
                  </div>
                  <input value={f.instruction} onChange={(e) => setForms((p) => ({ ...p, [m.id]: { ...f, instruction: e.target.value } }))}
                    placeholder="AIへの指示（任意）例: 比較記事を優先" className="cyber-input w-full px-2 py-1 rounded-lg text-[10px]" />
                </>
              )}
              <button onClick={() => save(m.id)} disabled={saving !== null}
                className="cyber-btn w-full py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
                {saving === m.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {f.enabled ? "保存して予定を作成" : "設定を保存"}
              </button>
              {msg[m.id] && <p className="text-[9px] leading-relaxed" style={{ color: "#34d399" }}>{msg[m.id]}</p>}
            </div>
          );
        })}
        {media.length === 0 && (
          <p className="text-[10px] p-2" style={{ color: "var(--text-muted)" }}>メディアがありません。AIライティング画面で追加・同期してください。</p>
        )}
      </div>

      {/* カレンダー */}
      <div className="glass-static rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(56,189,248,0.1)" }}>
          <button onClick={() => moveMonth(-1)} className="cyber-btn p-1.5 rounded-lg"><ChevronLeft size={14} /></button>
          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{cursor.y}年 {cursor.m}月</p>
          <button onClick={() => moveMonth(1)} className="cyber-btn p-1.5 rounded-lg"><ChevronRight size={14} /></button>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: 720 }}>
            <div className="grid grid-cols-7" style={{ borderBottom: "1px solid rgba(56,189,248,0.08)" }}>
              {WEEKDAYS.map((w, i) => (
                <p key={w} className="text-center text-[10px] font-bold py-1.5"
                  style={{ color: i === 0 ? "#f87171" : i === 6 ? "#38bdf8" : "var(--text-muted)" }}>{w}</p>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                const dateStr = day ? `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
                const dayEntries = day ? byDate.get(dateStr) ?? [] : [];
                const isToday = dateStr === today;
                return (
                  <div key={idx} className="min-h-[86px] p-1"
                    style={{
                      borderRight: (idx + 1) % 7 !== 0 ? "1px solid rgba(56,189,248,0.06)" : undefined,
                      borderBottom: "1px solid rgba(56,189,248,0.06)",
                      background: isToday ? "rgba(52,211,153,0.05)" : undefined,
                    }}>
                    {day && (
                      <p className="text-[10px] font-bold mb-1 px-1 flex items-center gap-1"
                        style={{ color: isToday ? "#34d399" : "var(--text-muted)" }}>
                        {day}
                        {isToday && <span className="text-[8px] px-1 rounded" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>今日</span>}
                      </p>
                    )}
                    <div className="space-y-1">
                      {dayEntries.map((e) => {
                        const color = colorOf(e.mediaId);
                        const done = e.status === "done";
                        const generating = e.status === "generating";
                        const link = e.workflow?.wpEditLink ?? e.workflow?.gdocUrl ?? null;
                        return (
                          <div key={e.id} className="group rounded-md px-1.5 py-1 text-[9px] leading-tight"
                            title={`${e.mediaName}\n${e.theme}\n状態: ${done ? "完了" : generating ? "生成中" : "予定"}${e.calendarSynced ? "\nAI秘書カレンダー登録済み" : ""}`}
                            style={{
                              background: done ? `${color}22` : "rgba(4,10,30,0.5)",
                              border: `1px solid ${color}${done ? "88" : "44"}`,
                            }}>
                            <div className="flex items-center gap-1">
                              {done ? <CheckCircle2 size={9} style={{ color }} className="shrink-0" />
                                : generating ? <PenLine size={9} style={{ color: "#facc15" }} className="shrink-0" />
                                : <Clock size={9} style={{ color }} className="shrink-0" />}
                              <span className="font-bold truncate" style={{ color }}>{e.mediaName}</span>
                              {e.calendarSynced && <span title="AI秘書カレンダー登録済み" className="shrink-0">📅</span>}
                              {e.status === "planned" && (
                                <button onClick={() => removeEntry(e)} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  style={{ color: "var(--text-muted)" }} title="この予定を取り消す">
                                  <X size={9} />
                                </button>
                              )}
                            </div>
                            {link ? (
                              <a href={link} target="_blank" rel="noopener noreferrer"
                                className="block truncate mt-0.5 underline decoration-dotted"
                                style={{ color: "var(--text)" }}>
                                {e.workflow?.finalArticleTitle ?? e.theme} <ExternalLink size={8} className="inline" />
                              </a>
                            ) : (
                              <p className="truncate mt-0.5" style={{ color: "var(--text)" }}>{e.theme}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5 flex-wrap" style={{ borderTop: "1px solid rgba(56,189,248,0.08)" }}>
          {loading && <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
          <span className="flex items-center gap-1 text-[9px]" style={{ color: "var(--text-muted)" }}><Clock size={9} /> 予定</span>
          <span className="flex items-center gap-1 text-[9px]" style={{ color: "var(--text-muted)" }}><PenLine size={9} style={{ color: "#facc15" }} /> 生成中</span>
          <span className="flex items-center gap-1 text-[9px]" style={{ color: "var(--text-muted)" }}><CheckCircle2 size={9} style={{ color: "#34d399" }} /> 完了（クリックで記事へ）</span>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>📅 = AI秘書（AICompany）のGoogleカレンダー登録済み</span>
          {scheduledMedia.length === 0 && (
            <span className="text-[9px]" style={{ color: "#fb923c" }}>スケジュール有効なメディアがありません。上の設定でONにしてください。</span>
          )}
        </div>
      </div>
    </div>
  );
}
