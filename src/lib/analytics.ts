// AICompany の /api/integrations/seo/analytics を呼ぶクライアント（GSC/GA4）。
// AICompanyのサービスアカウント（委任）を使うため、seo-agent側に認証情報は不要。

function analyticsUrl(): string | null {
  const profile = process.env.AI_COMPANY_PROFILE_URL;
  if (!profile) return null;
  return profile.replace(/\/profile.*$/, "/analytics");
}

async function callAic<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T | null> {
  const url = analyticsUrl();
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
  if (!url || !secret) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-company-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

export interface GscRow { key: string; clicks: number; impressions: number; ctr: number; position: number }
export interface Ga4Row { path: string; views: number; sessions: number; engagementRate: number; avgDuration: number }

export interface MetricsResult {
  ok?: boolean;
  resolvedProperty?: string | null;
  gscConnected?: boolean;
  ga4Connected?: boolean;
  gsc?: { property?: string; pages?: GscRow[]; queries?: GscRow[]; error?: string } | null;
  ga4?: Ga4Row[] | { error?: string } | null;
}

export async function fetchMetrics(opts: { domain?: string; gscProperty?: string | null; ga4PropertyId?: string | null; days?: number }) {
  return callAic<MetricsResult>({
    action: "metrics",
    domain: opts.domain,
    gscProperty: opts.gscProperty || undefined,
    ga4PropertyId: opts.ga4PropertyId || undefined,
    days: opts.days ?? 28,
  });
}

export async function fetchPageQueries(gscProperty: string, pageUrl: string, days = 28) {
  return callAic<{ ok?: boolean; queries?: GscRow[] }>({ action: "page_queries", gscProperty, pageUrl, days });
}

export async function verifyToken(siteUrl: string) {
  return callAic<{ ok?: boolean; token?: string; error?: string }>({ action: "verify_token", siteUrl });
}

export async function verifyConfirm(siteUrl: string) {
  return callAic<{ ok?: boolean; verified?: boolean; property?: string; error?: string }>({ action: "verify_confirm", siteUrl });
}

export async function listGscSites() {
  return callAic<{ ok?: boolean; sites?: { siteUrl: string; permission: string }[] }>({ action: "sites" });
}

export async function listGa4Properties() {
  return callAic<{ ok?: boolean; properties?: { propertyId: string; displayName: string; account: string }[] }>({ action: "ga4_properties" });
}

// GSCページ(URL)とGA4行(pagePath)を突き合わせるためのパス正規化
export function pathOf(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    return u.pathname.replace(/\/$/, "") || "/";
  } catch {
    return urlOrPath.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
  }
}

export interface DashboardRow {
  url: string;
  path: string;
  title?: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  views: number;       // GA4 PV
  candidate: null | { type: "rank" | "ctr"; reason: string; score: number };
}

// リライト候補の判定：順位あと一歩(4〜20位)で表示が多い / 高表示だがCTRが低い
export function rewriteCandidate(r: { impressions: number; ctr: number; position: number }): DashboardRow["candidate"] {
  if (r.position >= 3.5 && r.position <= 20 && r.impressions >= 30) {
    return { type: "rank", reason: `掲載${r.position.toFixed(1)}位・${r.impressions.toLocaleString()}表示 → 上位化でクリック増が狙える`, score: Math.round(r.impressions * Math.max(0, 21 - r.position)) };
  }
  if (r.impressions >= 100 && r.ctr < 0.02 && r.position <= 12) {
    return { type: "ctr", reason: `${r.impressions.toLocaleString()}表示・CTR${(r.ctr * 100).toFixed(1)}% → タイトル/説明の改善余地`, score: Math.round(r.impressions * 5) };
  }
  return null;
}
