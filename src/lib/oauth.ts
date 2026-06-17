type OAuthProvider = "google" | "github" | "aicompany";

export interface OAuthProfile {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
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

export function providerConfig(provider: OAuthProvider) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/callback/${provider}`;

  if (provider === "google") {
    return {
      provider,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: "openid email profile",
      redirectUri,
    };
  }

  if (provider === "github") {
    return {
      provider,
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
      emailUrl: "https://api.github.com/user/emails",
      scope: "read:user user:email",
      redirectUri,
    };
  }

  return {
    provider,
    clientId: process.env.AICOMPANY_CLIENT_ID,
    clientSecret: process.env.AICOMPANY_CLIENT_SECRET,
    authorizationUrl: process.env.AICOMPANY_AUTHORIZATION_URL,
    tokenUrl: process.env.AICOMPANY_TOKEN_URL,
    userInfoUrl: process.env.AICOMPANY_USERINFO_URL,
    scope: process.env.AICOMPANY_SCOPE ?? "openid email profile media.read analyst.read",
    redirectUri,
  };
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "github" || value === "aicompany";
}

export function normalizeProfile(provider: OAuthProvider, profile: Record<string, unknown>): OAuthProfile {
  if (provider === "google") {
    return {
      id: String(profile.sub),
      email: String(profile.email ?? ""),
      name: typeof profile.name === "string" ? profile.name : null,
      image: typeof profile.picture === "string" ? profile.picture : null,
    };
  }

  if (provider === "github") {
    return {
      id: String(profile.id),
      email: String(profile.email ?? ""),
      name: typeof profile.name === "string" ? profile.name : typeof profile.login === "string" ? profile.login : null,
      image: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
    };
  }

  const aiCompanyId = String(profile.aiCompanyId ?? profile.ai_company_id ?? profile.sub ?? profile.id ?? "");
  return {
    id: aiCompanyId,
    email: String(profile.email ?? ""),
    name: typeof profile.name === "string" ? profile.name : typeof profile.displayName === "string" ? profile.displayName : null,
    image: typeof profile.picture === "string" ? profile.picture : null,
    aiCompany: {
      aiCompanyId,
      displayName: typeof profile.displayName === "string" ? profile.displayName : typeof profile.name === "string" ? profile.name : null,
      defaultDomain: typeof profile.defaultDomain === "string" ? profile.defaultDomain : typeof profile.default_domain === "string" ? profile.default_domain : null,
      defaultProjectName: typeof profile.defaultProjectName === "string" ? profile.defaultProjectName : typeof profile.default_project_name === "string" ? profile.default_project_name : null,
      defaultObjective: typeof profile.defaultObjective === "string" ? profile.defaultObjective : typeof profile.default_objective === "string" ? profile.default_objective : null,
      defaultContext: typeof profile.defaultContext === "string" ? profile.defaultContext : typeof profile.default_context === "string" ? profile.default_context : null,
      settings: typeof profile.settings === "object" && profile.settings ? profile.settings as Record<string, unknown> : {},
    },
  };
}
