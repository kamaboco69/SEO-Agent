import { NextRequest, NextResponse } from "next/server";

// DataForSEO Backlinks API（APIキーあれば）
async function fetchDataForSEOBacklinks(domain: string) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;

  try {
    const credentials = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch("https://api.dataforseo.com/v3/backlinks/summary/live", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ target: domain, limit: 10 }]),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// モック被リンクデータ
function generateMockBacklinks(domain: string) {
  const referringDomains = [
    { domain: "qiita.com", da: 78, links: 12, type: "dofollow", anchor: domain },
    { domain: "zenn.dev", da: 71, links: 8, type: "dofollow", anchor: "こちら" },
    { domain: "note.com", da: 74, links: 5, type: "dofollow", anchor: domain },
    { domain: "hatena.ne.jp", da: 82, links: 23, type: "dofollow", anchor: "参考サイト" },
    { domain: "wired.jp", da: 77, links: 3, type: "nofollow", anchor: domain },
    { domain: "techcrunch.com", da: 91, links: 2, type: "nofollow", anchor: "リンク" },
    { domain: "itmedia.co.jp", da: 80, links: 7, type: "dofollow", anchor: domain },
    { domain: "gizmodo.jp", da: 75, links: 4, type: "dofollow", anchor: "詳しくはこちら" },
  ];

  const total = referringDomains.reduce((s, d) => s + d.links, 0);

  const opportunities = [
    { domain: "startups.co.jp", da: 65, reason: "同カテゴリのまとめ記事あり", difficulty: "低" },
    { domain: "b-pos.jp", da: 58, reason: "業界リソースページへの掲載チャンス", difficulty: "低" },
    { domain: "pr.times.jp", da: 76, reason: "プレスリリース経由で被リンク獲得可能", difficulty: "中" },
    { domain: "diamond.jp", da: 84, reason: "専門コラムへの寄稿で獲得可能", difficulty: "高" },
    { domain: "toukei.metro.tokyo.lg.jp", da: 88, reason: "公的データの引用元として掲載チャンス", difficulty: "高" },
  ];

  return {
    domain,
    totalBacklinks: total,
    referringDomains: referringDomains.length,
    dofollowRatio: 75,
    domainAuthority: Math.round(40 + Math.random() * 40),
    topReferrers: referringDomains,
    opportunities,
    isMock: true,
    note: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD が未設定のためデモデータを表示しています",
  };
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  const apiData = await fetchDataForSEOBacklinks(domain);

  if (apiData?.tasks?.[0]?.result?.[0]) {
    const r = apiData.tasks[0].result[0];
    return NextResponse.json({
      domain,
      totalBacklinks: r.backlinks,
      referringDomains: r.referring_domains,
      dofollowRatio: Math.round((r.backlinks_dofollow / r.backlinks) * 100),
      domainAuthority: r.domain_rank,
      isMock: false,
    });
  }

  return NextResponse.json(generateMockBacklinks(domain));
}
