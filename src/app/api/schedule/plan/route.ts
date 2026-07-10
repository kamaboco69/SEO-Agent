import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jstMidnight } from "@/lib/schedulePlan";

export const dynamic = "force-dynamic";

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
      calendarSynced: Boolean(e.calendarEventId),
      workflow: e.workflowId ? wfMap.get(e.workflowId) ?? null : null,
    })),
  });
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
