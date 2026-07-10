import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { reconcilePlan, syncCalendarEvents } from "@/lib/schedulePlan";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // スケジュール保存時のプラン生成（AIテーマ提案＋カレンダー登録）に余裕を持たせる

const JST = 9 * 3600 * 1000;

// JST基準の今月1日（自動スケジュールの「今月◯本」判定に使用）
function jstMonthStart(now = new Date()) {
  const j = new Date(now.getTime() + JST);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST);
}

function cleanDomain(input: string) {
  return input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function registerWithAICompany(media: {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  audience: string | null;
  tone: string | null;
  mainCategories: unknown;
}) {
  const endpoint = process.env.AI_COMPANY_MEDIA_REGISTER_URL;
  if (!endpoint) {
    return {
      syncStatus: "local_only",
      syncMessage: "AI_COMPANY_MEDIA_REGISTER_URL が未設定のため、SEO Agent内にのみ登録しました",
      aiCompanyMediaId: null,
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AI_COMPANY_WEBHOOK_SECRET
          ? { "x-ai-company-secret": process.env.AI_COMPANY_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        source: "seo-agent",
        localMediaId: media.id,
        name: media.name,
        domain: media.domain,
        description: media.description,
        audience: media.audience,
        tone: media.tone,
        mainCategories: media.mainCategories,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        syncStatus: "failed",
        syncMessage: data.error ?? `AICompany登録に失敗しました (${res.status})`,
        aiCompanyMediaId: null,
      };
    }

    return {
      syncStatus: "synced",
      syncMessage: "AICompanyに登録しました",
      aiCompanyMediaId: data.mediaId ?? data.id ?? null,
    };
  } catch {
    return {
      syncStatus: "failed",
      syncMessage: "AICompany登録APIに接続できませんでした",
      aiCompanyMediaId: null,
    };
  }
}

export async function GET() {
  const media = await prisma.media.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true, domain: true } },
      _count: { select: { workflows: true } },
    },
  });

  // 自動スケジュールの今月実績（作成本数）を付与
  const counts = await prisma.contentWorkflow.groupBy({
    by: ["mediaId"],
    where: { origin: "schedule", createdAt: { gte: jstMonthStart() } },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.mediaId, c._count._all]));
  const withSchedule = media.map((m) => ({ ...m, scheduledThisMonth: countMap.get(m.id) ?? 0 }));

  return NextResponse.json(withSchedule);
}

// スケジュール設定の更新（自動記事作成の 本数/月・文字数・指示・ON/OFF）
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body = await req.json();
  const mediaId = String(body.mediaId ?? "").trim();
  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  const s = (body.schedule ?? {}) as { enabled?: boolean; perMonth?: number; wordCount?: number | null; instruction?: string | null };
  const enabled = Boolean(s.enabled);
  const rawPer = Number(s.perMonth);
  const perMonth = Number.isFinite(rawPer) ? Math.min(30, Math.max(1, Math.round(rawPer))) : media.schedulePerMonth;
  const rawWc = Number(s.wordCount);
  const wordCount = Number.isFinite(rawWc) && rawWc > 0 ? Math.min(20000, Math.round(rawWc)) : null;
  const instruction = s.instruction ? String(s.instruction).trim() || null : null;

  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: {
      scheduleEnabled: enabled,
      schedulePerMonth: perMonth,
      scheduleWordCount: wordCount,
      scheduleInstruction: instruction,
      // 有効化したユーザーにトークン消費を計上する（cron実行時の契約チェックにも使用）
      ...(enabled ? { scheduleOwnerEmail: user.email } : {}),
    },
    include: {
      project: { select: { id: true, name: true, domain: true } },
      _count: { select: { workflows: true } },
    },
  });

  // 予定表を即時整合：有効なら今月・来月の予定（日付＋AIテーマ）を生成しAI秘書カレンダーへ登録、
  // 無効なら未実行の予定を取り消す。失敗しても設定自体は保存済み（cronが毎日再整合する）。
  const planLog: string[] = [];
  try {
    await reconcilePlan(updated, planLog);
    await syncCalendarEvents(updated, planLog);
  } catch {
    planLog.push("予定表の更新に失敗しました（毎日の定時チェックで自動リトライされます）");
  }

  return NextResponse.json({ ...updated, planLog });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const domain = cleanDomain(String(body.domain ?? ""));
  const projectId = body.projectId ? String(body.projectId) : null;
  const mainCategories = Array.isArray(body.mainCategories)
    ? body.mainCategories.map(String).map((item: string) => item.trim()).filter(Boolean)
    : String(body.mainCategories ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const media = await prisma.media.create({
    data: {
      projectId,
      name,
      domain,
      description: body.description ? String(body.description).trim() : null,
      audience: body.audience ? String(body.audience).trim() : null,
      tone: body.tone ? String(body.tone).trim() : null,
      mainCategories,
      syncStatus: "pending",
    },
  });

  const sync = await registerWithAICompany(media);
  const updated = await prisma.media.update({
    where: { id: media.id },
    data: sync,
    include: {
      project: { select: { id: true, name: true, domain: true } },
      _count: { select: { workflows: true } },
    },
  });

  return NextResponse.json(updated, { status: 201 });
}
