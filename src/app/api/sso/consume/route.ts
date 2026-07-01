import { NextRequest, NextResponse } from "next/server";
import { verifySsoToken } from "@/lib/aicompany-sso";
import { createSession, sessionCookieName, upsertUserFromIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

// /sso ページから同一オリジンで呼ばれ、ワンタイムトークンを検証してセッションを確立する。
// Set-Cookie は同一オリジン応答として返るため、埋め込みiframe（third-party文脈）でも
// Partitioned(CHIPS) 付きなら保存される（クロスサイトのリダイレクトで立てるより確実）。
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; redirect?: string };
  const token = typeof body.token === "string" ? body.token : null;
  const rawRedirect = typeof body.redirect === "string" ? body.redirect : "/";
  // オープンリダイレクト防止：相対パスのみ許可
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/";

  const payload = verifySsoToken(token);
  if (!payload) return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });

  const profileUrl = process.env.AI_COMPANY_PROFILE_URL;
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
  if (!profileUrl) return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });

  type AiCompanyProfile = {
    ok?: boolean; found?: boolean; aiCompanyId?: string; email?: string; name?: string | null;
    image?: string | null; displayName?: string | null; defaultDomain?: string | null;
    defaultProjectName?: string | null; defaultObjective?: string | null; defaultContext?: string | null;
    settings?: Record<string, unknown>;
  };
  let data: AiCompanyProfile | null = null;
  try {
    const r = await fetch(profileUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "x-ai-company-secret": secret } : {}) },
      body: JSON.stringify({ email: payload.email, source: "seo-agent" }),
    });
    data = (await r.json().catch(() => null)) as AiCompanyProfile | null;
  } catch {
    data = null;
  }

  if (!data?.ok || !data.found || !data.aiCompanyId) {
    return NextResponse.json({ ok: false, error: "aicompany_not_found" }, { status: 404 });
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

  const res = NextResponse.json({ ok: true, redirect });
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    // SameSite=None; Secure; Partitioned(CHIPS) を確実に付与（Next の cookies.set に依存しない）
    const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    const cookie = [
      `${sessionCookieName}=${session.rawToken}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=None",
      "Partitioned",
      `Expires=${session.expiresAt.toUTCString()}`,
      `Max-Age=${maxAge}`,
    ].join("; ");
    res.headers.append("Set-Cookie", cookie);
  } else {
    res.cookies.set(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
  }
  return res;
}
