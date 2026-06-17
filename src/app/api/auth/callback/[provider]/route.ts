import { NextRequest, NextResponse } from "next/server";
import { connectIdentityToUser, createSession, getCurrentUser, sessionCookieName, syncAiCompanyProfileByEmail, upsertUserFromIdentity } from "@/lib/auth";
import { isOAuthProvider, normalizeProfile, providerConfig } from "@/lib/oauth";

type Params = { params: Promise<{ provider: string }> };

async function exchangeCode(config: ReturnType<typeof providerConfig>, code: string) {
  if (!config.clientId || !config.clientSecret || !config.tokenUrl) {
    throw new Error("OAuth provider is not configured");
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? "token exchange failed");
  return data as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function fetchGithubEmail(accessToken: string, emailUrl?: string) {
  if (!emailUrl) return null;
  const res = await fetch(emailUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const emails = await res.json() as Array<{ email: string; primary?: boolean; verified?: boolean }>;
  return emails.find((email) => email.primary && email.verified)?.email ?? emails.find((email) => email.verified)?.email ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(`oauth_state_${provider}`)?.value;
  const callbackUrl = req.cookies.get("oauth_callback_url")?.value ?? "/";
  const connectMode = req.cookies.get("oauth_connect_mode")?.value === "1";

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=oauth_state", req.url));
  }

  try {
    const config = providerConfig(provider);
    const token = await exchangeCode(config, code);
    const profileRes = await fetch(config.userInfoUrl ?? "", {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: provider === "github" ? "application/vnd.github+json" : "application/json",
      },
    });
    const rawProfile = await profileRes.json() as Record<string, unknown>;
    if (!profileRes.ok) throw new Error("profile fetch failed");

    if (provider === "github" && !rawProfile.email) {
      rawProfile.email = await fetchGithubEmail(token.access_token, "emailUrl" in config ? config.emailUrl : undefined);
    }

    const profile = normalizeProfile(provider, rawProfile);
    if (!profile.email) throw new Error("email is required for account linking");
    if (!profile.id) throw new Error("provider account id is required");

    const identity = {
      provider,
      providerAccountId: profile.id,
      email: profile.email,
      name: profile.name,
      image: profile.image,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      aiCompany: profile.aiCompany,
    } as const;

    const cleanupCookies = (res: NextResponse) => {
      res.cookies.delete(`oauth_state_${provider}`);
      res.cookies.delete("oauth_callback_url");
      res.cookies.delete("oauth_connect_mode");
      return res;
    };

    if (connectMode) {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        return NextResponse.redirect(new URL("/login?error=session_expired", req.url));
      }
      await connectIdentityToUser(currentUser.id, identity);
      return cleanupCookies(NextResponse.redirect(new URL(callbackUrl, req.url)));
    }

    const user = await upsertUserFromIdentity(identity);

    // Google/GitHubログイン時は、同一メールのAICompanyユーザー設定を自動連携する。
    if (provider !== "aicompany") {
      await syncAiCompanyProfileByEmail(user.id, identity.email);
    }

    const session = await createSession(user.id);

    const res = NextResponse.redirect(new URL(callbackUrl, req.url));
    res.cookies.set(sessionCookieName, session.rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
    return cleanupCookies(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_callback_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, req.url));
  }
}
