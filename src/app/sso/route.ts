import { NextRequest, NextResponse } from "next/server";
import { verifySsoToken } from "@/lib/aicompany-sso";
import { createSession, sessionCookieName, upsertUserFromIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 埋め込み用SSOエントリ（AI Companyの「SEO対策」iframeから遷移）。
// ?token（AI Companyがワンタイム署名）を検証 → 同一emailのAI Companyプロフィールを取得 →
// SEO Agentユーザーへupsert → セッション発行 → ?redirect（既定 "/"）へ。
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const token = req.nextUrl.searchParams.get("token");
  const rawRedirect = req.nextUrl.searchParams.get("redirect") || "/";
  // オープンリダイレクト防止：相対パスのみ許可
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/";

  const payload = verifySsoToken(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/login?error=sso_token", origin), 302);
  }

  // AI Company のプロフィール（entitlement=マハル雇用含む）を取得
  const profileUrl = process.env.AI_COMPANY_PROFILE_URL;
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
  if (!profileUrl) {
    return NextResponse.redirect(new URL("/login?error=aicompany_unconfigured", origin), 302);
  }

  type AiCompanyProfile = {
    ok?: boolean; found?: boolean; aiCompanyId?: string; email?: string; name?: string | null;
    image?: string | null; displayName?: string | null; defaultDomain?: string | null;
    defaultProjectName?: string | null; defaultObjective?: string | null; defaultContext?: string | null;
    settings?: Record<string, unknown>;
  };
  let data: AiCompanyProfile | null = null;
  try {
    const res = await fetch(profileUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "x-ai-company-secret": secret } : {}) },
      body: JSON.stringify({ email: payload.email, source: "seo-agent" }),
    });
    data = (await res.json().catch(() => null)) as AiCompanyProfile | null;
  } catch {
    data = null;
  }

  if (!data?.ok || !data.found || !data.aiCompanyId) {
    return NextResponse.redirect(new URL("/login?error=aicompany_not_found", origin), 302);
  }

  const user = await upsertUserFromIdentity({
    provider: "aicompany",
    providerAccountId: String(data.aiCompanyId),
    email: data.email ?? payload.email,
    name: data.name ?? null,
    image: data.image ?? null,
    aiCompany: {
      aiCompanyId: String(data.aiCompanyId),
      displayName: data.displayName ?? data.name ?? null,
      defaultDomain: data.defaultDomain ?? null,
      defaultProjectName: data.defaultProjectName ?? null,
      defaultObjective: data.defaultObjective ?? null,
      defaultContext: data.defaultContext ?? null,
      settings: data.settings ?? {},
    },
  });

  const session = await createSession(user.id);

  const res = NextResponse.redirect(new URL(redirect, origin), 302);
  const isProd = process.env.NODE_ENV === "production";
  // iframe（サードパーティ文脈）でCookieを保存/送信するため、本番は
  // SameSite=None; Secure に加えて Partitioned（CHIPS）を付与する。
  // CHIPS はトップサイト単位で分離保存され、サードパーティCookie制限下でも
  // 埋め込みiframe内の自動ログインを成立させる（Chrome/Edge等）。
  res.cookies.set(sessionCookieName, session.rawToken, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    expires: session.expiresAt,
    ...(isProd ? { partitioned: true } : {}),
  });
  return res;
}
