import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { wpDiag } from "@/lib/wordpress";

export const dynamic = "force-dynamic";

// WordPress プラグイン（SEO Agent Connector）からの自動登録を受け付ける。
// 認証は「サイトへ diag コールバックして、送られてきた secret が実際にそのサイトで有効か」を確認することで担保する。
// → 自分が管理していないURLを勝手に登録することはできない（secretがそのサイトで通らないため）。
// メディアはドメインで識別（このアプリのMediaはドメイン単位のグローバル管理）。既存なら更新、無ければ作成。

function hostFromUrl(u: string): string | null {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    site_url?: string; secret?: string; site_name?: string; admin_email?: string;
  };
  const siteUrl = String(body.site_url ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  const siteName = body.site_name ? String(body.site_name).trim() : "";
  const adminEmail = body.admin_email ? String(body.admin_email).trim().toLowerCase() : "";

  if (!siteUrl || !secret) {
    return NextResponse.json({ ok: false, error: "site_url と secret は必須です" }, { status: 400 });
  }
  const host = hostFromUrl(siteUrl);
  if (!host) {
    return NextResponse.json({ ok: false, error: "site_url が不正です" }, { status: 400 });
  }

  // 所有確認：送られてきた secret でサイトの diag が通ることを確認する
  let siteTitle = siteName;
  try {
    const diag = await wpDiag(siteUrl, secret);
    if (!diag || diag.ok === false) throw new Error("diag_failed");
    if (!siteTitle && typeof diag.site === "string") siteTitle = diag.site;
  } catch {
    return NextResponse.json(
      { ok: false, error: "サイトの確認に失敗しました。プラグインが有効か、URLが正しいか確認してください。" },
      { status: 400 }
    );
  }

  const cleanUrl = siteUrl.replace(/\/+$/, "");

  const existing = await prisma.media.findFirst({ where: { domain: host } });
  let media;
  if (existing) {
    media = await prisma.media.update({
      where: { id: existing.id },
      data: { wpUrl: cleanUrl, wpSecret: secret, wpConnectedAt: new Date() },
    });
  } else {
    media = await prisma.media.create({
      data: {
        name: siteTitle || host,
        domain: host,
        wpUrl: cleanUrl,
        wpSecret: secret,
        wpConnectedAt: new Date(),
        syncStatus: "local_only",
        syncMessage: `WordPressプラグインから自動登録${adminEmail ? `（${adminEmail}）` : ""}`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    linked: true,
    created: !existing,
    mediaId: media.id,
    site: siteTitle || host,
  });
}
