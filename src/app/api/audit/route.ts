import { NextRequest, NextResponse } from "next/server";

interface AuditItem {
  category: string;
  label: string;
  status: "pass" | "warn" | "fail";
  value: string;
  tip: string;
}

async function auditUrl(url: string): Promise<AuditItem[]> {
  const items: AuditItem[] = [];

  let html = "";
  let fetchError = false;
  let finalUrl = url;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "SEOAgent/1.0 (+https://seo-agent.local/bot)",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    finalUrl = res.url;
    html = await res.text();

    // リダイレクト
    if (finalUrl !== url) {
      items.push({
        category: "技術",
        label: "リダイレクト",
        status: "warn",
        value: `→ ${finalUrl}`,
        tip: "リダイレクトが発生しています。正規URLに統一することを検討してください",
      });
    }

    // HTTPSチェック
    items.push({
      category: "技術",
      label: "HTTPS",
      status: finalUrl.startsWith("https") ? "pass" : "fail",
      value: finalUrl.startsWith("https") ? "HTTPS対応済み" : "HTTP（非暗号化）",
      tip: "サイト全体をHTTPSに移行してください",
    });
  } catch {
    fetchError = true;
    items.push({
      category: "技術",
      label: "URL到達性",
      status: "fail",
      value: "取得できませんでした",
      tip: "URLが正しいか、サーバーが応答しているか確認してください",
    });
    return items;
  }

  if (fetchError || !html) return items;

  // タイトル
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const titleLen = title.length;
  items.push({
    category: "コンテンツ",
    label: "タイトルタグ",
    status: !title ? "fail" : titleLen < 10 ? "warn" : titleLen > 70 ? "warn" : "pass",
    value: title ? `${title.slice(0, 50)}… (${titleLen}字)` : "未設定",
    tip: "タイトルは20〜60字が最適です。KWを先頭に配置しましょう",
  });

  // メタディスクリプション
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const metaDesc = metaMatch ? metaMatch[1].trim() : "";
  const metaLen = metaDesc.length;
  items.push({
    category: "コンテンツ",
    label: "メタディスクリプション",
    status: !metaDesc ? "fail" : metaLen < 50 ? "warn" : metaLen > 165 ? "warn" : "pass",
    value: metaDesc ? `${metaDesc.slice(0, 60)}… (${metaLen}字)` : "未設定",
    tip: "メタ説明は70〜160字が最適です。CTRを高めるCTAを含めましょう",
  });

  // H1
  const h1Matches = [...html.matchAll(/<h1[^>]*>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>)*[^<]*)<\/h1>/gi)];
  const h1Count = h1Matches.length;
  items.push({
    category: "コンテンツ",
    label: "H1タグ",
    status: h1Count === 0 ? "fail" : h1Count > 1 ? "warn" : "pass",
    value: h1Count === 0 ? "未設定" : `${h1Count}個`,
    tip: "H1タグはページに1つだけ設置してください",
  });

  // H2
  const h2Count = (html.match(/<h2/gi) ?? []).length;
  items.push({
    category: "コンテンツ",
    label: "H2タグ",
    status: h2Count === 0 ? "warn" : "pass",
    value: `${h2Count}個`,
    tip: "記事には3〜8個のH2見出しで構造化しましょう",
  });

  // 画像のalt属性
  const imgTags = [...html.matchAll(/<img[^>]+>/gi)];
  const imgTotal = imgTags.length;
  const imgNoAlt = imgTags.filter((m) => !m[0].includes("alt=") || m[0].includes('alt=""')).length;
  items.push({
    category: "コンテンツ",
    label: "画像のalt属性",
    status: imgNoAlt === 0 ? "pass" : imgNoAlt < imgTotal * 0.3 ? "warn" : "fail",
    value: imgTotal === 0 ? "画像なし" : `${imgTotal}枚中 ${imgNoAlt}枚が未設定`,
    tip: "すべての画像にalt属性を設定してください",
  });

  // canonical
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1];
  items.push({
    category: "技術",
    label: "canonical",
    status: canonical ? "pass" : "warn",
    value: canonical ? canonical.slice(0, 60) : "未設定",
    tip: "canonicalタグで正規URLを明示してください",
  });

  // robots
  const robotsMeta = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
  const isNoindex = robotsMeta.includes("noindex");
  items.push({
    category: "技術",
    label: "robots meta",
    status: isNoindex ? "fail" : "pass",
    value: robotsMeta || "index, follow（デフォルト）",
    tip: isNoindex ? "noindexが設定されています。意図的でない場合は削除してください" : "問題ありません",
  });

  // Open Graph
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1];
  items.push({
    category: "SNS",
    label: "OGP タイトル",
    status: ogTitle ? "pass" : "warn",
    value: ogTitle ? ogTitle.slice(0, 50) : "未設定",
    tip: "OGP タグを設定するとSNSシェア時の見栄えが向上します",
  });

  // 構造化データ
  const hasStructuredData = html.includes('application/ld+json');
  items.push({
    category: "技術",
    label: "構造化データ（JSON-LD）",
    status: hasStructuredData ? "pass" : "warn",
    value: hasStructuredData ? "設定済み" : "未設定",
    tip: "FAQ・パンくず・記事などの構造化データを追加するとリッチスニペット表示につながります",
  });

  // 内部リンク
  const internalLinks = (html.match(new RegExp(`href=["']${new URL(url).origin}[^"']*["']`, "gi")) ?? []).length;
  items.push({
    category: "コンテンツ",
    label: "内部リンク数",
    status: internalLinks === 0 ? "fail" : internalLinks < 3 ? "warn" : "pass",
    value: `${internalLinks}本`,
    tip: "内部リンクを3本以上設置してページランクを分散させましょう",
  });

  return items;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "無効なURLです" }, { status: 400 });
  }

  const items = await auditUrl(url);

  const passCount = items.filter((i) => i.status === "pass").length;
  const warnCount = items.filter((i) => i.status === "warn").length;
  const failCount = items.filter((i) => i.status === "fail").length;
  const score = Math.round((passCount / items.length) * 100);

  return NextResponse.json({ url, score, passCount, warnCount, failCount, items });
}
