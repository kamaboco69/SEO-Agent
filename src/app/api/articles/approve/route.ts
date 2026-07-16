import { NextRequest, NextResponse } from "next/server";
import { getAiCompanyEntitlement, getCurrentUser, reportAiCompanyUsage } from "@/lib/auth";
import { approveWithLatestDoc } from "@/lib/approveArticle";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 装飾HTMLの再生成（ストリーミング）に余裕を持たせる

// 記事の承認（フェーズ1）: 最新のGoogleドキュメントを取得→WordPress装飾HTMLを再生成。
// クライアントは続けて /api/pipeline PATCH { action: "wp_draft" } を呼び、画像生成込みでWPへ反映する。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const ent = await getAiCompanyEntitlement(user.id, user.email);
  if (!ent.entitled) {
    return NextResponse.json({ error: "この機能はAICompanyの有料プラン契約者のみ利用できます" }, { status: 403 });
  }
  const pre = await reportAiCompanyUsage(user.email);
  if (pre.ok && !pre.allowed) {
    return NextResponse.json({ error: pre.reason ?? "今月のトークン上限に達しています" }, { status: 402 });
  }

  const body = await req.json().catch(() => ({}));
  const workflowId = String(body.workflowId ?? "").trim();
  if (!workflowId) return NextResponse.json({ error: "workflowIdが必要です" }, { status: 400 });

  const r = await approveWithLatestDoc(workflowId, user.email);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 });
  return NextResponse.json({ ok: true, docUpdated: r.docUpdated, title: r.title });
}
