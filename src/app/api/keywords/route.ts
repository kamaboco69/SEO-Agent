import { NextRequest, NextResponse } from "next/server";

// Google Suggest を呼び出してキーワード候補を取得（無料）
async function fetchGoogleSuggest(keyword: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data[1] as string[]) ?? [];
  } catch {
    return [];
  }
}

// アルファベット・数字・助詞をくっつけてロングテール候補を生成
function generateVariations(keyword: string): string[] {
  const prefixes = ["", "とは", "意味", "やり方", "方法", "おすすめ", "比較", "違い", "料金", "無料"];
  const suffixes = ["とは", "方法", "やり方", "おすすめ", "比較", "違い", "料金", "初心者", "2024", "2025"];
  const variations: string[] = [];
  for (const p of prefixes) variations.push(`${keyword}${p}`);
  for (const s of suffixes) variations.push(`${keyword} ${s}`);
  return [...new Set(variations)].slice(0, 20);
}

// 難易度・ボリュームの推定（実データなしの場合のフォールバック）
function estimateMetrics(kw: string): {
  volume: number;
  difficulty: number;
  cpc: number;
  intent: string;
} {
  const len = kw.length;
  const hasWord = (words: string[]) => words.some((w) => kw.includes(w));

  let volume = Math.max(100, Math.round(10000 / Math.pow(len, 0.8)));
  let difficulty = Math.min(95, Math.round(30 + len * 2));
  let cpc = parseFloat((Math.random() * 300 + 50).toFixed(0));
  let intent = "情報収集";

  if (hasWord(["買う", "購入", "最安値", "料金", "値段", "価格"])) {
    intent = "購買";
    volume = Math.round(volume * 0.5);
    difficulty = Math.min(95, difficulty + 15);
    cpc = parseFloat((cpc * 2).toFixed(0));
  } else if (hasWord(["とは", "意味", "違い", "仕組み"])) {
    intent = "情報収集";
    volume = Math.round(volume * 1.5);
    difficulty = Math.max(10, difficulty - 10);
  } else if (hasWord(["やり方", "方法", "手順", "コツ"])) {
    intent = "解決策";
  } else if (hasWord(["おすすめ", "比較", "ランキング", "口コミ"])) {
    intent = "比較検討";
    difficulty = Math.min(95, difficulty + 5);
  }

  return { volume, difficulty, cpc, intent };
}

export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("q");
  if (!keyword) return NextResponse.json({ error: "q is required" }, { status: 400 });

  const [suggestions, variations] = await Promise.all([
    fetchGoogleSuggest(keyword),
    Promise.resolve(generateVariations(keyword)),
  ]);

  // メインKWのメトリクス
  const mainMetrics = estimateMetrics(keyword);

  // 全候補をマージ
  const allKws = [...new Set([keyword, ...suggestions, ...variations])].slice(0, 50);

  const results = allKws.map((kw) => ({
    keyword: kw,
    ...estimateMetrics(kw),
    isMain: kw === keyword,
    source: suggestions.includes(kw) ? "google" : kw === keyword ? "input" : "generated",
  }));

  // 質問系キーワード（PAA風）
  const questions = [
    `${keyword}とは何ですか`,
    `${keyword}の使い方`,
    `${keyword}はどうやって`,
    `${keyword}のメリットデメリット`,
    `${keyword}に必要なもの`,
  ];

  return NextResponse.json({
    keyword,
    mainMetrics,
    results: results.sort((a, b) => b.volume - a.volume),
    questions,
    relatedTopics: suggestions.slice(0, 8),
  });
}
