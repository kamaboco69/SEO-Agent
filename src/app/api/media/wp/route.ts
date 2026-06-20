import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { wpDiag } from "@/lib/wordpress";

export const dynamic = "force-dynamic";

// メディアにWordPress接続(コネクタ)を設定。接続テスト(diag)を行ってから保存する。
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mediaId = String(body.mediaId ?? "").trim();
  const wpUrl = String(body.wpUrl ?? "").trim();
  const wpSecret = String(body.wpSecret ?? "").trim();

  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
  if (!wpUrl || !wpSecret) return NextResponse.json({ error: "URLと接続シークレットを入力してください" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  // 接続テスト
  try {
    const diag = await wpDiag(wpUrl, wpSecret);
    await prisma.media.update({
      where: { id: mediaId },
      data: { wpUrl, wpSecret, wpConnectedAt: new Date() },
    });
    return NextResponse.json({ ok: true, site: diag.site ?? null, version: diag.version ?? null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "接続テストに失敗しました" },
      { status: 502 }
    );
  }
}

// 接続解除
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
  await prisma.media.update({ where: { id: mediaId }, data: { wpUrl: null, wpSecret: null, wpConnectedAt: null } });
  return NextResponse.json({ ok: true });
}
