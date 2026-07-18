import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncWpPublished } from "@/lib/wpPublishSync";

export const dynamic = "force-dynamic";

// 記事履歴: これまでに執筆・下書きした記事の一覧（全メディア＋フリー執筆）。
// 本文やステップは含めない軽量リスト（プレビューは /api/pipeline?id= で個別取得）。
export async function GET(req: NextRequest) {
  const take = Math.min(300, Math.max(1, Number(req.nextUrl.searchParams.get("take")) || 200));
  let workflows = await prisma.contentWorkflow.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      origin: true,
      clientName: true,
      targetTheme: true,
      selectedArticle: true,
      finalArticleTitle: true,
      targetWordCount: true,
      wpPostId: true,
      wpEditLink: true,
      wpViewLink: true,
      wpPublished: true,
      gdocId: true,
      gdocUrl: true,
      imagesGenerated: true,
      media: { select: { id: true, name: true, domain: true, wpUrl: true, wpConnectedAt: true } },
    },
  });

  // WP管理画面から直接公開された記事も「公開済み」表示になるよう実状態を同期
  const synced = await syncWpPublished(workflows);
  if (synced.size > 0) {
    workflows = workflows.map((w) =>
      synced.has(w.id) ? { ...w, wpPublished: true, status: "completed" } : w
    );
  }

  return NextResponse.json(
    workflows.map((w) => ({
      ...w,
      // 承認（最新Doc反映→装飾→画像付きWP下書き）が可能か
      canApprove: Boolean(w.media?.wpUrl && w.status !== "in_progress" && (w.finalArticleTitle || w.selectedArticle)),
    }))
  );
}
