import { NextRequest, NextResponse } from "next/server";
import { agentEmail, publishWorkflow } from "@/lib/agentBridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Doc編集ありの場合は装飾HTML再生成＋画像再生成が走る

// AI Companyブリッジ: 記事の公開（LINEの承認ボタンから）。
// Googleドキュメントが編集されていれば最新内容を取り込んでから公開する。
export async function POST(req: NextRequest) {
  const email = agentEmail(req);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { workflowId?: string };
  const workflowId = String(body.workflowId ?? "").trim();
  if (!workflowId) return NextResponse.json({ error: "workflowIdが必要です" }, { status: 400 });

  const r = await publishWorkflow(workflowId, email);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 });
  return NextResponse.json(r);
}
