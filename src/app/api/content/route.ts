import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// SEOスコア算出
function calcSeoScore(content: string, targetKw: string, title: string, metaDesc: string) {
  let score = 0;
  const checks: { label: string; ok: boolean; tip: string }[] = [];

  const text = content.toLowerCase();
  const kw = targetKw.toLowerCase();
  const wordCount = content.replace(/<[^>]+>/g, "").length;

  // タイトルにKW含む
  const titleHasKw = title.toLowerCase().includes(kw);
  checks.push({ label: "タイトルにKW含む", ok: titleHasKw, tip: "タイトルの先頭寄りにKWを入れましょう" });
  if (titleHasKw) score += 15;

  // メタディスクリプションにKW含む
  const metaHasKw = metaDesc.toLowerCase().includes(kw);
  checks.push({ label: "メタ説明にKW含む", ok: metaHasKw, tip: "メタ説明の先頭にKWを含めましょう" });
  if (metaHasKw) score += 10;

  // 文字数チェック
  const enoughWords = wordCount >= 1500;
  checks.push({ label: `文字数 ${wordCount}字 (推奨1500以上)`, ok: enoughWords, tip: "1500字以上を目安に充実させましょう" });
  if (wordCount >= 3000) score += 15;
  else if (wordCount >= 1500) score += 10;
  else if (wordCount >= 800) score += 5;

  // 本文にKW含む
  const kwInContent = text.includes(kw);
  checks.push({ label: "本文にKW含む", ok: kwInContent, tip: "本文の冒頭100字以内にKWを入れましょう" });
  if (kwInContent) score += 15;

  // KW密度
  const kwCount = (text.match(new RegExp(kw, "g")) ?? []).length;
  const density = wordCount > 0 ? (kwCount / wordCount) * 100 : 0;
  const goodDensity = density >= 0.5 && density <= 3;
  checks.push({ label: `KW密度 ${density.toFixed(1)}% (適正0.5〜3%)`, ok: goodDensity, tip: "KWを詰め込みすぎず、自然に配置しましょう" });
  if (goodDensity) score += 10;

  // H2タグ
  const h2Count = (content.match(/<h2/gi) ?? []).length;
  const hasH2 = h2Count >= 3;
  checks.push({ label: `H2見出し ${h2Count}個 (推奨3以上)`, ok: hasH2, tip: "記事を3〜8個のH2で構造化しましょう" });
  if (hasH2) score += 10;

  // 内部リンク
  const internalLinks = (content.match(/<a[^>]+href="\/[^"]*"/gi) ?? []).length;
  const hasInternalLinks = internalLinks >= 2;
  checks.push({ label: `内部リンク ${internalLinks}本 (推奨2以上)`, ok: hasInternalLinks, tip: "関連記事への内部リンクを2本以上設置しましょう" });
  if (hasInternalLinks) score += 10;

  // 画像
  const imgCount = (content.match(/<img/gi) ?? []).length;
  const hasImages = imgCount >= 1;
  checks.push({ label: `画像 ${imgCount}枚`, ok: hasImages, tip: "視覚的に分かりやすくするため画像を入れましょう" });
  if (hasImages) score += 5;

  // タイトル長
  const goodTitleLen = title.length >= 20 && title.length <= 60;
  checks.push({ label: `タイトル長 ${title.length}字 (推奨20〜60字)`, ok: goodTitleLen, tip: "タイトルは32字前後が検索結果での表示に最適です" });
  if (goodTitleLen) score += 5;

  // メタ長
  const goodMetaLen = metaDesc.length >= 70 && metaDesc.length <= 160;
  checks.push({ label: `メタ説明 ${metaDesc.length}字 (推奨70〜160字)`, ok: goodMetaLen, tip: "メタ説明は120字前後が理想です" });
  if (goodMetaLen) score += 5;

  return { score: Math.min(100, score), checks, wordCount, kwCount, density };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, content, targetKw, title, metaDesc, prompt } = body;

  if (action === "score") {
    const result = calcSeoScore(content ?? "", targetKw ?? "", title ?? "", metaDesc ?? "");
    return NextResponse.json(result);
  }

  if (action === "generate") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 503 });
    }

    const systemPrompt = `あなたはSEOに精通した日本語コンテンツライターです。
SEOに最適化された高品質な記事を作成します。
- ターゲットキーワードを自然に含める
- E-E-A-T（経験・専門性・権威性・信頼性）を意識する
- ユーザーの検索意図に応える
- 見出し(H2/H3)で構造化する
- 日本語として自然で読みやすい文章にする`;

    const userPrompt = prompt ?? `キーワード「${targetKw}」で2000字以上のSEO記事を作成してください。
H2を5〜8個使い、読者の検索意図を満たす完全なガイドにしてください。
出力はMarkdown形式で。`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (action === "suggest_meta") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        title: `${targetKw}とは？完全ガイド【2025年版】`,
        metaDesc: `${targetKw}について徹底解説。基本から応用まで、初心者でもわかりやすく説明します。この記事を読めば${targetKw}のすべてがわかります。`,
      });
    }

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `キーワード「${targetKw}」に最適なSEOタイトル（32字前後）とメタディスクリプション（120字前後）を生成してください。
JSON形式で { "title": "...", "metaDesc": "..." } のみ返してください。`,
        },
      ],
    });

    try {
      const text = msg.content[0].type === "text" ? msg.content[0].text : "";
      const json = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
      return NextResponse.json(json);
    } catch {
      return NextResponse.json({
        title: `${targetKw}とは？完全ガイド【2025年版】`,
        metaDesc: `${targetKw}について徹底解説します。`,
      });
    }
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
