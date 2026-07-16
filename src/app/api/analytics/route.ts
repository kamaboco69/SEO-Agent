import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { fetchMetrics, pathOf, rewriteCandidate, type DashboardRow, type GscRow, type Ga4Row } from "@/lib/analytics";
import { wpPosts } from "@/lib/wordpress";
import { cacheGet, cacheSet } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GSC/GA4は日次更新のデータなので6時間キャッシュ（「更新」ボタン=refresh=1 で最新化できる）
const CACHE_TTL_SEC = 6 * 3600;

// WordPressのタイトルに含まれるHTMLエンティティを復号
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}

// GET /api/analytics?mediaId=&days= → 記事(ページ)ごとのGSC/GA4指標＋リライト候補
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const mediaId = req.nextUrl.searchParams.get("mediaId") ?? "";
  const days = Math.min(180, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 28)));
  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  // キャッシュ（GSC/GA4取得＋WPタイトル補完が重いため）。refresh=1 で強制再取得。
  const cacheKey = `analytics:${mediaId}:${days}`;
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (!refresh) {
    const hit = await cacheGet<Record<string, unknown>>(cacheKey);
    if (hit) {
      return NextResponse.json({ ...hit.value, fromCache: true, fetchedAt: hit.updatedAt.toISOString() });
    }
  }

  const connected = Boolean(media.gscProperty || media.wpUrl);
  const res = await fetchMetrics({
    domain: media.domain,
    gscProperty: media.gscProperty,
    ga4PropertyId: media.ga4PropertyId,
    days,
  });

  const rawPages: GscRow[] = (res?.gsc && "pages" in res.gsc ? res.gsc.pages : []) ?? [];
  const queries: GscRow[] = (res?.gsc && "queries" in res.gsc ? res.gsc.queries : []) ?? [];

  // #アンカー付きURLは同一ページに集約（表示/クリックは合算、順位は表示数で加重平均）
  const byUrl = new Map<string, GscRow>();
  for (const p of rawPages) {
    const base = p.key.split("#")[0];
    const ex = byUrl.get(base);
    if (!ex) { byUrl.set(base, { ...p, key: base }); continue; }
    const imp = ex.impressions + p.impressions;
    ex.position = imp ? (ex.position * ex.impressions + p.position * p.impressions) / imp : ex.position;
    ex.clicks += p.clicks;
    ex.impressions = imp;
    ex.ctr = imp ? ex.clicks / imp : 0;
  }
  const gscPages = [...byUrl.values()];
  const ga4Rows: Ga4Row[] = Array.isArray(res?.ga4) ? (res.ga4 as Ga4Row[]) : [];
  const ga4ByPath = new Map(ga4Rows.map((r) => [pathOf(r.path), r]));
  const pageQueries: Record<string, GscRow[]> = (res?.gsc && "pageQueries" in res.gsc ? res.gsc.pageQueries : {}) ?? {};

  // 記事タイトルの補完（自分が生成した記事のURL→タイトル）
  const workflows = await prisma.contentWorkflow.findMany({
    where: { mediaId, NOT: { wpViewLink: null } },
    select: { finalArticleTitle: true, wpViewLink: true },
  });
  const titleByPath = new Map<string, string | null>(workflows.filter((w) => w.wpViewLink).map((w) => [pathOf(w.wpViewLink as string), w.finalArticleTitle]));

  // WordPressの全投稿・固定ページのタイトルでURL→タイトルを補完（既存記事のタイトルも表示するため）
  if (media.wpUrl && media.wpSecret) {
    try {
      for (const type of ["post", "page"]) {
        for (let page = 1; page <= 5; page++) {
          const wp = await wpPosts(media.wpUrl, media.wpSecret, { perPage: 100, page, status: "publish", postType: type });
          for (const p of wp.posts) titleByPath.set(pathOf(p.url), decodeEntities(p.title));
          if (page >= wp.totalPages || wp.posts.length === 0) break;
        }
      }
    } catch {
      /* WP未応答時はタイトル補完なしで続行 */
    }
  }

  const rows: DashboardRow[] = gscPages.map((p) => {
    const path = pathOf(p.key);
    const ga4 = ga4ByPath.get(path);
    return {
      url: p.key,
      path,
      title: titleByPath.get(path) ?? null,
      impressions: p.impressions,
      clicks: p.clicks,
      ctr: p.ctr,
      position: p.position,
      views: ga4?.views ?? 0,
      queries: (pageQueries[p.key] ?? []).map((q) => ({ query: q.key, impressions: q.impressions, position: q.position, clicks: q.clicks })),
      candidate: rewriteCandidate(p),
    };
  });

  // GSCがまだ無い(未計測)がGA4だけある場合の補完
  if (rows.length === 0 && ga4Rows.length > 0) {
    for (const g of ga4Rows) {
      rows.push({ url: g.path, path: pathOf(g.path), title: titleByPath.get(pathOf(g.path)) ?? null, impressions: 0, clicks: 0, ctr: 0, position: 0, views: g.views, queries: [], candidate: null });
    }
  }

  rows.sort((a, b) => b.impressions - a.impressions || b.views - a.views);
  const candidates = rows.filter((r) => r.candidate).sort((a, b) => (b.candidate!.score) - (a.candidate!.score));

  const summary = {
    totalImpressions: rows.reduce((s, r) => s + r.impressions, 0),
    totalClicks: rows.reduce((s, r) => s + r.clicks, 0),
    avgPosition: rows.length ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / (rows.reduce((s, r) => s + r.impressions, 0) || 1) : 0,
    totalViews: rows.reduce((s, r) => s + r.views, 0),
    pageCount: rows.length,
    candidateCount: candidates.length,
  };

  const payload = {
    connected,
    gscConnected: Boolean(res?.gscConnected),
    ga4Connected: Boolean(res?.ga4Connected),
    property: res?.resolvedProperty ?? media.gscProperty ?? null,
    ga4PropertyId: media.ga4PropertyId,
    days,
    summary,
    rows,
    candidates: candidates.slice(0, 30),
    topQueries: queries.sort((a, b) => b.impressions - a.impressions).slice(0, 20),
  };
  await cacheSet(cacheKey, payload, CACHE_TTL_SEC);
  return NextResponse.json({ ...payload, fromCache: false, fetchedAt: new Date().toISOString() });
}
