import { NextRequest, NextResponse } from "next/server";
import { createStateToken } from "@/lib/auth";
import { isOAuthProvider, providerConfig } from "@/lib/oauth";

type Params = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  const config = providerConfig(provider);
  if (!config.clientId || !config.authorizationUrl) {
    return NextResponse.redirect(new URL(`/login?error=${provider}_not_configured`, req.url));
  }

  const state = createStateToken();
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/";
  const connectMode = req.nextUrl.searchParams.get("mode") === "connect";
  const authUrl = new URL(config.authorizationUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  res.cookies.set("oauth_callback_url", callbackUrl, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  if (connectMode) {
    res.cookies.set("oauth_connect_mode", "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });
  }
  return res;
}
