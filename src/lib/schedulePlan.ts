import Anthropic from "@anthropic-ai/sdk";
import type { Media, ScheduledArticle } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchWpContext } from "@/lib/aiSteps";

// 自動スケジュールの「執筆予定」管理。
// - 今月・来月ぶんの予定（日付＋AIが提案したテーマ）を常に保つ（reconcilePlan）
// - 予定はAI秘書（AICompany）のGoogleカレンダーにも終日予定として登録する（syncCalendarEvents）
// - cron（/api/schedule/tick）が予定日を迎えたエントリを執筆に回す

const PLAN_MODEL = "claude-haiku-4-5-20251001";
const JST = 9 * 3600 * 1000;

// ── JST日付ヘルパー ──────────────────────────────────────────

export function jstParts(d = new Date()) {
  const j = new Date(d.getTime() + JST);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), day: j.getUTCDate() };
}

// そのJST日の00:00をUTCのDateで返す（plannedDateの保存形式）
export function jstMidnight(y: number, m: number, day: number) {
  return new Date(Date.UTC(y, m, day) - JST);
}

export function jstDateString(d: Date) {
  return new Date(d.getTime() + JST).toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

// ── AICompany AI秘書カレンダー連携 ───────────────────────────

type AicCalendarResult = { ok?: boolean; eventId?: string | null; url?: string | null; connected?: boolean; error?: string };

async function aicCalendar(body: Record<string, unknown>): Promise<AicCalendarResult> {
  const profile = process.env.AI_COMPANY_PROFILE_URL;
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
  if (!profile || !secret) return { ok: false, error: "AICompany連携が未設定です" };
  try {
    const res = await fetch(profile.replace(/\/profile.*$/, "/calendar"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-company-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return ((await res.json().catch(() => null)) as AicCalendarResult | null) ?? { ok: false, error: `calendar API ${res.status}` };
  } catch {
    return { ok: false, error: "AICompanyに接続できませんでした" };
  }
}

// ── テーマのAI提案 ───────────────────────────────────────────

async function proposeThemes(media: Media, count: number, avoid: string[]): Promise<{ themes: string[]; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { themes: [], error: "ANTHROPIC_API_KEY未設定" };
  const wp = await fetchWpContext(media);
  const existing = (wp?.existingArticles ?? []).map((a) => a.title).slice(0, 150);
  const cats = Array.isArray(media.mainCategories) ? media.mainCategories.map(String).filter(Boolean) : [];

  const prompt = [
    `あなたはSEO編集長です。以下のメディアで次に書くべきSEO記事のテーマを${count}本提案してください。`,
    `# メディア`,
    `名前: ${media.name} / ドメイン: ${media.domain}`,
    media.description ? `説明: ${media.description}` : "",
    cats.length ? `主要カテゴリ: ${cats.join(", ")}` : "",
    media.scheduleInstruction ? `運用方針（オーナーの指示）: ${media.scheduleInstruction}` : "",
    existing.length ? `# 既存記事（${wp?.totalPublished ?? existing.length}本。重複するテーマは提案しない）\n${existing.join("\n")}` : "# 既存記事情報なし",
    avoid.length ? `# すでに予定済み・作成済みのテーマ（これらとも重複禁止）\n${avoid.join("\n")}` : "",
    `# 条件`,
    `- 検索流入が見込める具体的なテーマ（狙う検索キーワードが分かる粒度）`,
    `- 既存記事とテーマ・キーワードが重複しないこと`,
    `- 検索ボリュームと勝ちやすさのバランスが良いものから順に`,
    `# 出力形式（JSONのみ・説明不要）`,
    `["テーマ1", "テーマ2", ...]（ちょうど${count}本）`,
  ].filter(Boolean).join("\n");

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: PLAN_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as unknown;
    const themes = Array.isArray(parsed) ? parsed.map(String).map((t) => t.trim()).filter(Boolean) : [];
    if (!themes.length) return { themes: [], error: "テーマ提案の解析に失敗" };
    return { themes: themes.slice(0, count) };
  } catch (e) {
    return { themes: [], error: e instanceof Error ? e.message : "AI呼び出しに失敗" };
  }
}

// ── プラン整合（今月・来月の予定を目標本数に合わせる） ────────

// window[start..end] の日に need 本を均等配置（既に予定がある日は避ける）
function slotDays(start: number, end: number, need: number, taken: Set<number>): number[] {
  const span = end - start + 1;
  if (span <= 0 || need <= 0) return [];
  const days: number[] = [];
  for (let i = 0; i < need; i++) {
    let day = start + Math.min(span - 1, Math.floor(((i + 0.5) * span) / need));
    // 使用済みの日を避けて前後にずらす
    let offset = 0;
    while (taken.has(day) && offset < 31) {
      offset += 1;
      day = day + offset <= end ? day + offset : Math.max(start, day - offset);
    }
    taken.add(day);
    days.push(day);
  }
  return days.sort((a, b) => a - b);
}

async function deleteEntryWithCalendar(entry: ScheduledArticle, ownerEmail: string | null, log: string[]) {
  if (entry.calendarEventId && ownerEmail) {
    const r = await aicCalendar({ action: "delete", email: ownerEmail, eventId: entry.calendarEventId });
    if (r.error) log.push(`カレンダー削除失敗（${entry.theme}）: ${r.error}`);
  }
  await prisma.scheduledArticle.delete({ where: { id: entry.id } });
}

// スケジュール無効化時：未実行の予定を全て削除（カレンダーからも消す）
export async function cancelPlannedEntries(media: Pick<Media, "id" | "scheduleOwnerEmail">, log: string[]) {
  const entries = await prisma.scheduledArticle.findMany({ where: { mediaId: media.id, status: "planned" } });
  for (const e of entries) await deleteEntryWithCalendar(e, media.scheduleOwnerEmail, log);
  if (entries.length) log.push(`未実行の予定 ${entries.length} 件を取り消しました`);
}

// 今月・来月の予定を schedulePerMonth に合わせて増減する。
// 増やすときはAIがテーマを提案。戻り値は新規作成した件数。
export async function reconcilePlan(media: Media, log: string[]): Promise<number> {
  if (!media.scheduleEnabled) {
    await cancelPlannedEntries(media, log);
    return 0;
  }
  const target = Math.max(1, media.schedulePerMonth || 1);
  const today = jstParts();

  type MonthPlan = { y: number; m: number; need: number; days: number[] };
  const months: MonthPlan[] = [];

  for (const off of [0, 1]) {
    const y = today.m + off > 11 ? today.y + 1 : today.y;
    const m = (today.m + off) % 12;
    const monthStart = jstMidnight(y, m, 1);
    const monthEnd = jstMidnight(y, m + 1, 1);
    const entries = await prisma.scheduledArticle.findMany({
      where: { mediaId: media.id, plannedDate: { gte: monthStart, lt: monthEnd } },
      orderBy: { plannedDate: "asc" },
    });

    let count = entries.length;

    // 今月ぶんは「プラン外で既に自動作成された記事」も本数に算入する（作りすぎ防止）
    if (off === 0) {
      const linked = entries.map((e) => e.workflowId).filter((id): id is string => Boolean(id));
      count += await prisma.contentWorkflow.count({
        where: {
          mediaId: media.id,
          origin: "schedule",
          createdAt: { gte: monthStart },
          ...(linked.length ? { id: { notIn: linked } } : {}),
        },
      });
    }

    // 縮小：未来の planned を日付の遅い順に削除
    if (count > target) {
      const tomorrow = jstMidnight(today.y, today.m, today.day + 1);
      const removable = entries
        .filter((e) => e.status === "planned" && (off > 0 || e.plannedDate >= tomorrow))
        .sort((a, b) => b.plannedDate.getTime() - a.plannedDate.getTime())
        .slice(0, count - target);
      for (const e of removable) await deleteEntryWithCalendar(e, media.scheduleOwnerEmail, log);
      if (removable.length) log.push(`${y}年${m + 1}月: 予定を${removable.length}件減らしました`);
      count -= removable.length;
    }

    // 拡大：不足分の日付スロットを確保
    const need = Math.max(0, target - count);
    if (need > 0) {
      const start = off === 0 ? Math.min(today.day + 1, daysInMonth(y, m)) : 1;
      const end = daysInMonth(y, m);
      const taken = new Set(entries.map((e) => jstParts(e.plannedDate).day));
      const days = slotDays(start, end, need, taken);
      months.push({ y, m, need: days.length, days });
    }
  }

  const totalNeed = months.reduce((s, mp) => s + mp.need, 0);
  if (totalNeed === 0) return 0;

  // テーマをまとめて提案（既存プラン＋直近作成分と重複しないように）
  const existingPlans = await prisma.scheduledArticle.findMany({
    where: { mediaId: media.id }, orderBy: { plannedDate: "desc" }, take: 30, select: { theme: true },
  });
  const recentWfs = await prisma.contentWorkflow.findMany({
    where: { mediaId: media.id }, orderBy: { createdAt: "desc" }, take: 10,
    select: { finalArticleTitle: true, selectedArticle: true },
  });
  const avoid = [
    ...existingPlans.map((p) => p.theme),
    ...recentWfs.map((w) => w.finalArticleTitle || w.selectedArticle).filter((t): t is string => Boolean(t)),
  ];

  const { themes, error } = await proposeThemes(media, totalNeed, avoid);
  if (error || themes.length < totalNeed) {
    log.push(`${media.name}: テーマ提案に失敗（${error ?? "提案数不足"}）→ 次回リトライ`);
    return 0;
  }

  let i = 0;
  let created = 0;
  for (const mp of months) {
    for (const day of mp.days) {
      await prisma.scheduledArticle.create({
        data: { mediaId: media.id, plannedDate: jstMidnight(mp.y, mp.m, day), theme: themes[i] },
      });
      i += 1;
      created += 1;
    }
    log.push(`${media.name}: ${mp.y}年${mp.m + 1}月に予定を${mp.days.length}件作成`);
  }
  return created;
}

// カレンダー未登録の予定をAI秘書（AICompany）のGoogleカレンダーに登録する
export async function syncCalendarEvents(media: Media, log: string[]): Promise<void> {
  if (!media.scheduleOwnerEmail) return;
  const entries = await prisma.scheduledArticle.findMany({
    where: { mediaId: media.id, status: { in: ["planned", "generating"] }, calendarEventId: null },
    orderBy: { plannedDate: "asc" },
  });
  for (const e of entries) {
    const r = await aicCalendar({
      action: "create",
      email: media.scheduleOwnerEmail,
      title: `【SEO自動執筆】${media.name}：${e.theme}`,
      date: jstDateString(e.plannedDate),
      description: [
        "SEO Agent の自動スケジュール執筆予定です。",
        `メディア: ${media.name}（${media.domain}）`,
        `テーマ: ${e.theme}`,
        media.scheduleWordCount ? `目標文字数: ${media.scheduleWordCount.toLocaleString()}字` : "目標文字数: AIが自動判断",
        "この日に自動で執筆され、完成後はWordPressに下書き保存されます。",
        "※AIが自動実行するメモです。時間はブロックしません（「予定なし」扱い）。ミーティング等の日程調整には影響しません。",
      ].join("\n"),
    });
    if (!r.ok) {
      // Google未連携などは全件同じ理由で失敗するため1回で打ち切り（次回tickで再試行）
      log.push(`AI秘書カレンダー登録に失敗: ${r.error ?? "不明"}（次回再試行）`);
      return;
    }
    await prisma.scheduledArticle.update({
      where: { id: e.id },
      data: { calendarEventId: r.eventId ?? null, calendarUrl: r.url ?? null },
    });
  }
  if (entries.length) log.push(`AI秘書カレンダーに${entries.length}件登録しました`);
}

// 執筆完了をプランに反映
export async function markPlanDone(workflowId: string) {
  await prisma.scheduledArticle.updateMany({ where: { workflowId }, data: { status: "done" } });
}
