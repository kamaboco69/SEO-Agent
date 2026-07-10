import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildAvoidList, jstMidnight, proposeThemes, syncCalendarEvents } from "@/lib/schedulePlan";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // テーマ空欄時のAI提案（既存記事取得込み）に余裕を持たせる

// 執筆スケジュール（カレンダー表示用）。month=YYYY-MM の予定＋実行結果リンクを返す。
export async function GET(req: NextRequest) {
  const monthParam = req.nextUrl.searchParams.get("month"); // YYYY-MM
  const m = monthParam?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth();

  const start = jstMidnight(year, month, 1);
  const end = jstMidnight(year, month + 1, 1);

  const entries = await prisma.scheduledArticle.findMany({
    where: { plannedDate: { gte: start, lt: end } },
    include: { media: { select: { id: true, name: true, domain: true } } },
    orderBy: { plannedDate: "asc" },
  });

  // 実行済みエントリにワークフローの成果物リンクを付与
  const wfIds = entries.map((e) => e.workflowId).filter((id): id is string => Boolean(id));
  const wfs = wfIds.length
    ? await prisma.contentWorkflow.findMany({
        where: { id: { in: wfIds } },
        select: { id: true, status: true, finalArticleTitle: true, wpEditLink: true, wpViewLink: true, gdocUrl: true },
      })
    : [];
  const wfMap = new Map(wfs.map((w) => [w.id, w]));

  return NextResponse.json({
    year,
    month: month + 1,
    entries: entries.map((e) => ({
      id: e.id,
      mediaId: e.mediaId,
      mediaName: e.media.name,
      mediaDomain: e.media.domain,
      // JSTの日付文字列（カレンダーセル割当用）
      date: new Date(e.plannedDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10),
      theme: e.theme,
      status: e.status,
      source: e.source,
      calendarSynced: Boolean(e.calendarEventId),
      workflow: e.workflowId ? wfMap.get(e.workflowId) ?? null : null,
    })),
  });
}

// 手動で日付を指定して予定を追加（自動プランと併用）。
// テーマ未入力ならAIが提案。手動予定は自動調整で削除されず、スケジュールOFFのメディアでも予定日に実行される。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mediaId = String(body.mediaId ?? "").trim();
  const dateStr = String(body.date ?? "").trim(); // YYYY-MM-DD（JST）
  let theme = body.theme ? String(body.theme).trim() : "";

  if (!mediaId) return NextResponse.json({ error: "mediaIdが必要です" }, { status: 400 });
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return NextResponse.json({ error: "日付（YYYY-MM-DD）を指定してください" }, { status: 400 });

  const plannedDate = jstMidnight(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (dateStr < todayJst) return NextResponse.json({ error: "過去の日付には予定を追加できません" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "メディアが見つかりません" }, { status: 404 });

  const log: string[] = [];

  // テーマ未入力ならAIが1本提案（既存記事・予定済みテーマと重複しない）
  if (!theme) {
    const avoid = await buildAvoidList(mediaId);
    const p = await proposeThemes(media, 1, avoid);
    if (p.error || !p.themes.length) {
      return NextResponse.json({ error: `テーマのAI提案に失敗しました（${p.error ?? "不明"}）。テーマを入力して再実行してください。` }, { status: 502 });
    }
    theme = p.themes[0];
    log.push("テーマはAIが提案しました");
  }

  // 実行時の契約チェック・トークン計上先（未設定なら追加したユーザー）
  const owner = media.scheduleOwnerEmail ?? user.email;
  if (!media.scheduleOwnerEmail) {
    await prisma.media.update({ where: { id: mediaId }, data: { scheduleOwnerEmail: owner } });
  }

  const entry = await prisma.scheduledArticle.create({
    data: { mediaId, plannedDate, theme, source: "manual" },
  });

  // AI秘書のGoogleカレンダーへ即登録（transparent＝時間はブロックしない）
  await syncCalendarEvents({ ...media, scheduleOwnerEmail: owner }, log);
  const fresh = await prisma.scheduledArticle.findUnique({ where: { id: entry.id } });

  return NextResponse.json({ ok: true, entry: fresh, log }, { status: 201 });
}

// 予定の個別削除（テーマが不要な場合など）。カレンダーからも削除する。
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const entry = await prisma.scheduledArticle.findUnique({ where: { id }, include: { media: true } });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.status !== "planned") {
    return NextResponse.json({ error: "実行済み・進行中の予定は削除できません" }, { status: 400 });
  }
  if (entry.calendarEventId && entry.media.scheduleOwnerEmail) {
    const profile = process.env.AI_COMPANY_PROFILE_URL;
    const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
    if (profile && secret) {
      await fetch(profile.replace(/\/profile.*$/, "/calendar"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ai-company-secret": secret },
        body: JSON.stringify({ action: "delete", email: entry.media.scheduleOwnerEmail, eventId: entry.calendarEventId }),
      }).catch(() => null);
    }
  }
  await prisma.scheduledArticle.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
