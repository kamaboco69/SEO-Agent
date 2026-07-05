import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { verifyToken, verifyConfirm } from "@/lib/analytics";
import { wpSetVerification, wpSetGa4 } from "@/lib/wordpress";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/analytics/measure
//  { mediaId, action:"gsc" }                         → プラグインで所有権自動確認しGSC計測開始
//  { mediaId, action:"ga4", ga4PropertyId }          → 既存GA4プロパティを紐付け（読み取り用）
//  { mediaId, action:"ga4_install", measurementId }  → プラグインでGA4タグを設置（新規計測）
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { mediaId?: string; action?: string; ga4PropertyId?: string; measurementId?: string };
  const mediaId = String(body.mediaId ?? "").trim();
  const action = String(body.action ?? "gsc").trim();
  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  // GSC: プラグインでmetaタグ設置→所有権確認→GSC登録
  if (action === "gsc") {
    if (!media.wpUrl || !media.wpSecret) {
      return NextResponse.json({ error: "このメディアはWordPress未接続です。先にプラグインで連携してください。" }, { status: 400 });
    }
    const siteUrl = `${media.wpUrl.replace(/\/+$/, "")}/`;
    try {
      const tok = await verifyToken(siteUrl);
      if (!tok?.token) return NextResponse.json({ error: tok?.error ?? "確認トークンの発行に失敗しました（委任スコープを確認してください）" }, { status: 502 });

      const set = await wpSetVerification(media.wpUrl, media.wpSecret, tok.token);
      if (!set?.ok) return NextResponse.json({ error: "プラグインへのタグ設置に失敗しました" }, { status: 502 });

      const conf = await verifyConfirm(siteUrl);
      if (!conf?.ok || !conf.property) return NextResponse.json({ error: conf?.error ?? "所有権の確認に失敗しました。キャッシュが原因の場合はサイトのキャッシュをクリアして再実行してください。" }, { status: 502 });

      const updated = await prisma.media.update({
        where: { id: mediaId },
        data: { gscProperty: conf.property, analyticsConnectedAt: new Date() },
      });
      return NextResponse.json({ ok: true, gscProperty: updated.gscProperty });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "計測開始に失敗しました" }, { status: 500 });
    }
  }

  // GA4: 既存プロパティIDを紐付け（データ読み取り用）
  if (action === "ga4") {
    const pid = String(body.ga4PropertyId ?? "").replace(/[^0-9]/g, "");
    if (!pid) return NextResponse.json({ error: "ga4PropertyIdが必要です" }, { status: 400 });
    const updated = await prisma.media.update({ where: { id: mediaId }, data: { ga4PropertyId: pid } });
    return NextResponse.json({ ok: true, ga4PropertyId: updated.ga4PropertyId });
  }

  // GA4: プラグインで測定タグを新規設置（G-XXXX）
  if (action === "ga4_install") {
    if (!media.wpUrl || !media.wpSecret) return NextResponse.json({ error: "WordPress未接続です" }, { status: 400 });
    const mid = String(body.measurementId ?? "").trim().toUpperCase();
    if (!/^G-[A-Z0-9]+$/.test(mid)) return NextResponse.json({ error: "測定ID(G-XXXX)の形式が不正です" }, { status: 400 });
    const set = await wpSetGa4(media.wpUrl, media.wpSecret, mid);
    if (!set?.ok) return NextResponse.json({ error: "GA4タグの設置に失敗しました" }, { status: 502 });
    return NextResponse.json({ ok: true, measurementId: mid });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
