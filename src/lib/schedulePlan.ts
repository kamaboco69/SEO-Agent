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

export async function proposeThemes(media: Media, count: number, avoid: string[]): Promise<{ themes: string[]; error?: string }> {
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

// スケジュール無効化時：未実行の「自動」予定を削除（カレンダーからも消す）。
// 手動で日付指定した予定はユーザーの意思なので残し、予定日に実行される。
export async function cancelPlannedEntries(media: Pick<Media, "id" | "scheduleOwnerEmail">, log: string[]) {
  const entries = await prisma.scheduledArticle.findMany({
    where: { mediaId: media.id, status: "planned", source: "auto" },
  });
  for (const e of entries) await deleteEntryWithCalendar(e, media.scheduleOwnerEmail, log);
  if (entries.length) log.push(`未実行の自動予定 ${entries.length} 件を取り消しました（手動指定の予定は残ります）`);
}

// テーマ重複回避リスト（既存プラン＋直近の作成記事）
export async function buildAvoidList(mediaId: string): Promise<string[]> {
  const existingPlans = await prisma.scheduledArticle.findMany({
    where: { mediaId }, orderBy: { plannedDate: "desc" }, take: 30, select: { theme: true },
  });
  const recentWfs = await prisma.contentWorkflow.findMany({
    where: { mediaId }, orderBy: { createdAt: "desc" }, take: 10,
    select: { finalArticleTitle: true, selectedArticle: true },
  });
  return [
    ...existingPlans.map((p) => p.theme),
    ...recentWfs.map((w) => w.finalArticleTitle || w.selectedArticle).filter((t): t is string => Boolean(t)),
  ];
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

    // 縮小：未来の「自動」planned を日付の遅い順に削除（手動指定の予定は削除しない）
    if (count > target) {
      const tomorrow = jstMidnight(today.y, today.m, today.day + 1);
      const removable = entries
        .filter((e) => e.status === "planned" && e.source === "auto" && (off > 0 || e.plannedDate >= tomorrow))
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
  const avoid = await buildAvoidList(media.id);
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
    const wc = e.wordCount ?? media.scheduleWordCount;
    const r = await aicCalendar({
      action: "create",
      email: media.scheduleOwnerEmail,
      title: `【SEO自動執筆】${media.name}：${e.theme}`,
      date: jstDateString(e.plannedDate),
      description: [
        "SEO Agent の自動スケジュール執筆予定です。",
        `メディア: ${media.name}（${media.domain}）`,
        `テーマ: ${e.theme}`,
        wc ? `目標文字数: ${wc.toLocaleString()}字` : "目標文字数: AIが自動判断",
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

// 予定の編集（日付・テーマ）。実行前（planned）の予定のみ。
// カレンダーは旧イベントを削除→未同期に戻し、再同期で新しい日付・テーマの終日予定を作り直す。
export async function updatePlanEntry(
  id: string,
  changes: { date?: string | null; theme?: string | null; wordCount?: number | null; hasWordCount?: boolean }
): Promise<{ entry?: ScheduledArticle; error?: string; log: string[] }> {
  const log: string[] = [];
  const entry = await prisma.scheduledArticle.findUnique({ where: { id }, include: { media: true } });
  if (!entry) return { error: "予定が見つかりません", log };
  if (entry.status !== "planned") return { error: "実行済み・進行中の予定は編集できません", log };

  const data: { plannedDate?: Date; theme?: string; wordCount?: number | null; calendarEventId?: null; calendarUrl?: null } = {};
  if (changes.date) {
    const m = changes.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { error: "日付（YYYY-MM-DD）の形式が不正です", log };
    const todayJst = new Date(Date.now() + JST).toISOString().slice(0, 10);
    if (changes.date < todayJst) return { error: "過去の日付には変更できません", log };
    data.plannedDate = jstMidnight(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const theme = changes.theme?.trim();
  if (theme) data.theme = theme;
  // 文字数: 数値=この予定だけの指定 / null=クリア（メディア設定・AI判断に戻す）
  if (changes.hasWordCount) {
    if (changes.wordCount != null) {
      const wc = Math.round(Number(changes.wordCount));
      if (!Number.isFinite(wc) || wc <= 0 || wc > 20000) return { error: "文字数は1〜20000で指定してください", log };
      data.wordCount = wc;
    } else {
      data.wordCount = null;
    }
  }
  if (!data.plannedDate && !data.theme && !changes.hasWordCount) return { error: "変更内容がありません", log };

  if (entry.calendarEventId && entry.media.scheduleOwnerEmail) {
    const r = await aicCalendar({ action: "delete", email: entry.media.scheduleOwnerEmail, eventId: entry.calendarEventId });
    if (r.error) log.push(`旧カレンダー予定の削除に失敗: ${r.error}`);
    data.calendarEventId = null;
    data.calendarUrl = null;
  }

  await prisma.scheduledArticle.update({ where: { id }, data });
  await syncCalendarEvents(entry.media, log);
  const fresh = await prisma.scheduledArticle.findUnique({ where: { id } });
  return { entry: fresh ?? undefined, log };
}

// 執筆完了をプランに反映
export async function markPlanDone(workflowId: string) {
  await prisma.scheduledArticle.updateMany({ where: { workflowId }, data: { status: "done" } });
}
