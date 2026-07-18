import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentEmail, startMediaWorkflow, workflowSnapshot } from "@/lib/agentBridge";
import { advanceWorkflow, aiErrorMessage, includeWorkflow } from "@/lib/pipelineRunner";
import { syncWpPublished } from "@/lib/wpPublishSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 記事執筆ステップ（ストリーミング）に余裕を持たせる

// AI Companyブリッジ: 執筆パイプラインの開始・1ステップ実行・状態取得。
// AI Company側（Cloud Run）がこのAPIを繰り返し呼んでパイプラインを最後まで駆動する。

// GET ?id=... 単体スナップショット / ?recent=1 直近一覧（LIFFの状況表示用）
export async function GET(req: NextRequest) {
  if (!agentEmail(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    let wf = await prisma.contentWorkflow.findUnique({ where: { id }, include: includeWorkflow() });
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
    // WP管理画面から直接公開された場合もラベルが「公開済み」になるよう実状態を同期
    const synced = await syncWpPublished([wf]);
    if (synced.has(wf.id)) {
      wf = (await prisma.contentWorkflow.findUnique({ where: { id }, include: includeWorkflow() })) ?? wf;
    }
    return NextResponse.json(workflowSnapshot(wf));
  }
  // mediaId指定でそのメディアの記事だけに絞り込める（LIFFのメディア切替表示用）。
  // 未指定は全メディア横断。クライアント側フィルタでも成立するよう多めに返す。
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  const where = mediaId ? { mediaId } : { mediaId: { not: null } };
  let rows = await prisma.contentWorkflow.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 24,
    include: includeWorkflow(),
  });
  const synced = await syncWpPublished(rows);
  if (synced.size > 0) {
    rows = await prisma.contentWorkflow.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 24,
      include: includeWorkflow(),
    });
  }
  return NextResponse.json({ workflows: rows.map(workflowSnapshot) });
}

// POST: 開始（メディア分析まで実行して workflowId を返す）
export async function POST(req: NextRequest) {
  const email = agentEmail(req);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    mediaId?: string;
    instruction?: string;
    targetTheme?: string;
    targetWordCount?: number;
  };
  const mediaId = String(body.mediaId ?? "").trim();
  if (!mediaId) return NextResponse.json({ error: "mediaIdが必要です" }, { status: 400 });

  const r = await startMediaWorkflow(email, mediaId, {
    instruction: body.instruction,
    targetTheme: body.targetTheme,
    targetWordCount: body.targetWordCount,
  });
  if (r.error || !r.workflow) return NextResponse.json({ error: r.error ?? "開始に失敗しました" }, { status: r.status ?? 500 });
  return NextResponse.json(workflowSnapshot(r.workflow), { status: 201 });
}

// PATCH: 1ステップ進める（全ステップ完了後はWP画像付き下書き保存まで自動で行われる）
export async function PATCH(req: NextRequest) {
  const email = agentEmail(req);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { workflowId?: string };
  const workflowId = String(body.workflowId ?? "").trim();
  if (!workflowId) return NextResponse.json({ error: "workflowIdが必要です" }, { status: 400 });

  const wf = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });

  const adv = await advanceWorkflow(wf, email);
  if (adv.aiError) {
    return NextResponse.json({ ...workflowSnapshot(adv.workflow), aiError: aiErrorMessage(adv.aiError) }, { status: 200 });
  }
  return NextResponse.json({ ...workflowSnapshot(adv.workflow), finished: adv.finished });
}
