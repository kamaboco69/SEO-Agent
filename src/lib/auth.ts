import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { sessionCookieName } from "@/lib/authConstants";

export { sessionCookieName };

export interface AuthIdentity {
  provider: "google" | "github" | "aicompany";
  providerAccountId: string;
  email: string;
  name?: string | null;
  image?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  aiCompany?: {
    aiCompanyId: string;
    displayName?: string | null;
    defaultDomain?: string | null;
    defaultProjectName?: string | null;
    defaultObjective?: string | null;
    defaultContext?: string | null;
    settings?: Record<string, unknown>;
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createStateToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function upsertUserFromIdentity(identity: AuthIdentity) {
  const email = normalizeEmail(identity.email);

  const linked = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    include: { user: true },
  });

  const user =
    linked?.user ??
    (await prisma.authUser.upsert({
      where: { email },
      update: {
        name: identity.name ?? undefined,
        image: identity.image ?? undefined,
      },
      create: {
        email,
        name: identity.name ?? undefined,
        image: identity.image ?? undefined,
      },
    }));

  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    update: {
      userId: user.id,
      email,
      accessToken: identity.accessToken ?? undefined,
      refreshToken: identity.refreshToken ?? undefined,
      expiresAt: identity.expiresAt ?? undefined,
    },
    create: {
      userId: user.id,
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      email,
      accessToken: identity.accessToken ?? undefined,
      refreshToken: identity.refreshToken ?? undefined,
      expiresAt: identity.expiresAt ?? undefined,
    },
  });

  if (identity.aiCompany) {
    await prisma.aiCompanyProfile.upsert({
      where: { userId: user.id },
      update: {
        aiCompanyId: identity.aiCompany.aiCompanyId,
        displayName: identity.aiCompany.displayName ?? identity.name ?? undefined,
        email,
        defaultDomain: identity.aiCompany.defaultDomain ?? undefined,
        defaultProjectName: identity.aiCompany.defaultProjectName ?? undefined,
        defaultObjective: identity.aiCompany.defaultObjective ?? undefined,
        defaultContext: identity.aiCompany.defaultContext ?? undefined,
        settings: (identity.aiCompany.settings ?? undefined) as never,
      },
      create: {
        userId: user.id,
        aiCompanyId: identity.aiCompany.aiCompanyId,
        displayName: identity.aiCompany.displayName ?? identity.name ?? null,
        email,
        defaultDomain: identity.aiCompany.defaultDomain ?? null,
        defaultProjectName: identity.aiCompany.defaultProjectName ?? null,
        defaultObjective: identity.aiCompany.defaultObjective ?? null,
        defaultContext: identity.aiCompany.defaultContext ?? null,
        settings: (identity.aiCompany.settings ?? {}) as never,
      },
    });
  }

  return user;
}

export async function createSession(userId: string) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const sessionToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  await prisma.authSession.create({
    data: {
      userId,
      sessionToken,
      expiresAt,
    },
  });

  return { rawToken, expiresAt };
}

export async function getCurrentUser() {
  const store = await cookies();
  const rawToken = store.get(sessionCookieName)?.value;
  if (!rawToken) return null;

  const session = await prisma.authSession.findUnique({
    where: { sessionToken: hashToken(rawToken) },
    include: {
      user: {
        include: {
          accounts: true,
          aiCompany: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function connectIdentityToUser(userId: string, identity: AuthIdentity) {
  const email = normalizeEmail(identity.email);

  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    update: {
      userId,
      email,
      accessToken: identity.accessToken ?? undefined,
      refreshToken: identity.refreshToken ?? undefined,
      expiresAt: identity.expiresAt ?? undefined,
    },
    create: {
      userId,
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      email,
      accessToken: identity.accessToken ?? undefined,
      refreshToken: identity.refreshToken ?? undefined,
      expiresAt: identity.expiresAt ?? undefined,
    },
  });

  if (identity.aiCompany) {
    await prisma.aiCompanyProfile.upsert({
      where: { userId },
      update: {
        aiCompanyId: identity.aiCompany.aiCompanyId,
        displayName: identity.aiCompany.displayName ?? identity.name ?? undefined,
        email,
        defaultDomain: identity.aiCompany.defaultDomain ?? undefined,
        defaultProjectName: identity.aiCompany.defaultProjectName ?? undefined,
        defaultObjective: identity.aiCompany.defaultObjective ?? undefined,
        defaultContext: identity.aiCompany.defaultContext ?? undefined,
        settings: (identity.aiCompany.settings ?? undefined) as never,
      },
      create: {
        userId,
        aiCompanyId: identity.aiCompany.aiCompanyId,
        displayName: identity.aiCompany.displayName ?? identity.name ?? null,
        email,
        defaultDomain: identity.aiCompany.defaultDomain ?? null,
        defaultProjectName: identity.aiCompany.defaultProjectName ?? null,
        defaultObjective: identity.aiCompany.defaultObjective ?? null,
        defaultContext: identity.aiCompany.defaultContext ?? null,
        settings: (identity.aiCompany.settings ?? {}) as never,
      },
    });
  }
}

// Google/GitHub等でログインした検証済みemailを使い、AICompany側の
// 同一メールユーザーの設定をサーバー間で取得して自動連携する。
// AICompany未登録・未設定・到達不可の場合はfalseを返すだけでログインは妨げない。
export async function syncAiCompanyProfileByEmail(userId: string, rawEmail: string): Promise<boolean> {
  const url = process.env.AI_COMPANY_PROFILE_URL;
  if (!url) return false;
  const email = normalizeEmail(rawEmail);
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-ai-company-secret": secret } : {}),
      },
      body: JSON.stringify({ email, source: "seo-agent" }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null) as
      | { ok?: boolean; found?: boolean; aiCompanyId?: string; email?: string; name?: string | null; image?: string | null; displayName?: string | null; defaultDomain?: string | null; defaultProjectName?: string | null; defaultObjective?: string | null; defaultContext?: string | null; settings?: Record<string, unknown> }
      | null;

    if (!data?.ok || !data.found || !data.aiCompanyId) return false;

    await connectIdentityToUser(userId, {
      provider: "aicompany",
      providerAccountId: String(data.aiCompanyId),
      email: data.email ?? email,
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
    return true;
  } catch {
    return false;
  }
}

export interface Entitlement {
  found: boolean;     // AICompanyアカウントに連携できたか
  entitled: boolean;  // 有料プラン且つアクティブか
  planName: string | null;
  billingUrl: string | null;
}

// 現在ユーザーのAICompany契約状態を最新同期して返す。
export async function getAiCompanyEntitlement(userId: string, email: string): Promise<Entitlement> {
  if (process.env.AI_COMPANY_PROFILE_URL) {
    await syncAiCompanyProfileByEmail(userId, email);
  }
  const profile = await prisma.aiCompanyProfile.findUnique({ where: { userId } });
  const settings = (profile?.settings ?? {}) as {
    entitled?: boolean;
    planName?: string | null;
    billingUrl?: string | null;
  };
  return {
    found: Boolean(profile),
    entitled: Boolean(settings.entitled),
    planName: settings.planName ?? null,
    billingUrl: settings.billingUrl ?? null,
  };
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const rawToken = store.get(sessionCookieName)?.value;
  if (!rawToken) return;
  await prisma.authSession.deleteMany({ where: { sessionToken: hashToken(rawToken) } });
}
