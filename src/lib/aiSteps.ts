import Anthropic from "@anthropic-ai/sdk";
import type { Media, WorkflowStep } from "@prisma/client";
import { generateStepOutput, type WorkflowStepKey } from "@/lib/contentWorkflow";
import { wpPosts, wpTaxonomies } from "@/lib/wordpress";

// 一気通貫パイプラインの各ステップを「本物のAI」で実行する。
// ANTHROPIC_API_KEY 未設定時は contentWorkflow.ts のテンプレ生成にフォールバックする。

const WRITING_MODEL = "claude-sonnet-4-6"; // 記事執筆
const RESEARCH_MODEL = "claude-haiku-4-5-20251001"; // メディア分析・KW・競合などの調査系

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type StepContext = {
  media: Pick<Media, "name" | "domain" | "description" | "audience" | "tone" | "mainCategories" | "wpUrl" | "wpSecret">;
  instruction: string;
  targetTheme?: string | null;
  targetWordCount?: number | null;
  steps: Pick<WorkflowStep, "key" | "output" | "revisionNote">[];
};

// WordPress接続済みなら、既存記事・カテゴリを取得して「不足記事の特定」「実在する内部リンク」の材料にする
async function fetchWpContext(media: StepContext["media"]) {
  if (!media.wpUrl || !media.wpSecret) return null;
  try {
    const [posts, tax] = await Promise.all([
      wpPosts(media.wpUrl, media.wpSecret, { perPage: 50, status: "publish" }),
      wpTaxonomies(media.wpUrl, media.wpSecret, 40),
    ]);
    return {
      totalPublished: posts.total,
      existingArticles: posts.posts.map((p) => ({ title: p.title, url: p.url, categories: p.categories })),
      categories: tax.categories.map((c) => ({ name: c.name, url: c.url, count: c.count })),
    };
  } catch {
    return null;
  }
}

// 執筆系ステップのmax_tokens。指定文字数が大きいほど余裕を持たせる（streamで受けるので大きくてOK）
function writingMaxTokens(targetWordCount?: number | null): number {
  if (!targetWordCount || targetWordCount <= 0) return 8000;
  return Math.min(32000, Math.max(8000, Math.ceil(targetWordCount * 2.4) + 2500));
}

// 対象メディアの実サイト(トップページ)からテキストを取得し、分析の材料にする。
async function fetchSiteContext(media: StepContext["media"]): Promise<string | null> {
  const target = media.wpUrl?.trim() || `https://${media.domain}`;
  const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (SEO Agent)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .slice(0, 40);
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
    return [`URL: ${url}`, `TITLE: ${title}`, `HEADINGS: ${headings.join(" / ")}`, `TEXT: ${body}`].join("\n");
  } catch {
    return null;
  }
}

function mediaCategories(media: StepContext["media"]) {
  return Array.isArray(media.mainCategories)
    ? media.mainCategories.map(String).filter(Boolean)
    : [];
}

function priorOutputs(context: StepContext) {
  const map: Record<string, unknown> = {};
  for (const step of context.steps) {
    if (step.output && Object.keys(step.output as object).length > 0) {
      map[step.key] = step.output;
    }
  }
  return map;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 最初の { ... } / [ ... ] ブロックを救出
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── swell_format 用ヘルパー（HTMLはJSONに包まず生で扱う）──
function stripCodeFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:html)?\s*\n?/i, "");
  t = t.replace(/\n?```\s*$/i, "");
  return t.trim();
}

function extractImageComments(html: string): string[] {
  return [...html.matchAll(/<!--\s*IMAGE:\s*([\s\S]*?)-->/gi)].map((m) => m[1].trim()).filter(Boolean);
}

// IMAGEコメントが1つも無ければ、先頭にアイキャッチ用コメントを差し込む（＝WordPressのアイキャッチ担保）
function ensureEyecatch(html: string, title: string): string {
  if (/<!--\s*IMAGE:/i.test(html)) return html;
  return `<!-- IMAGE: 記事「${title}」のアイキャッチ。テーマを象徴する清潔でモダンな編集向けビジュアル -->\n${html}`;
}

// h2/h3にcolor指定が無い場合、濃い文字色を注入（テーマの薄色/白抜きで見出しが見えなくなるのを防ぐ）
function ensureHeadingColor(html: string): string {
  return html.replace(/<(h2|h3)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const color = tag.toLowerCase() === "h2" ? "#1a2b45" : "#22303f";
    if (/style\s*=/.test(attrs)) {
      if (/color\s*:/i.test(attrs)) return m; // 既に色指定あり → 尊重
      return `<${tag}${attrs.replace(/style\s*=\s*"([^"]*)"/i, (_mm, s: string) => `style="color:${color} !important;${s}"`)}>`;
    }
    return `<${tag}${attrs} style="color:${color} !important;">`;
  });
}

function inlineMd(s: string): string {
  let t = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__(.+?)__/g, "<strong>$1</strong>");
  return t;
}

// Markdown本文を決定的に装飾HTML化（AI変換が失敗した時の完全フォールバック。本文は絶対に落とさない）
function markdownToHtml(md: string, title: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let listOrdered = false;
  const H2 = 'style="color:#1a2b45 !important;background:#eef4fb;border-left:6px solid #2b6cb0;padding:.5em .8em;font-size:1.35em;font-weight:700;border-radius:0 6px 6px 0;margin:1.6em 0 .8em;"';
  const H3 = 'style="color:#22303f !important;border-bottom:2px solid #cbd5e0;padding-bottom:.25em;font-size:1.15em;font-weight:700;margin:1.4em 0 .6em;"';

  const flushPara = () => { if (para.length) { out.push(`<p>${inlineMd(para.join(" "))}</p>`); para = []; } };
  const flushList = () => {
    if (list && list.length) {
      const tag = listOrdered ? "ol" : "ul";
      out.push(`<${tag} style="padding-left:1.4em;margin:1em 0;">${list.map((li) => `<li style="margin:.3em 0;">${inlineMd(li)}</li>`).join("")}</${tag}>`);
    }
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 表: ヘッダ行 + 区切り行(|---|---|)
    if (/^\|.*\|$/.test(trimmed) && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? "").trim())) {
      flushPara(); flushList();
      const header = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\|.*\|$/.test(lines[j].trim())) {
        rows.push(lines[j].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        j++;
      }
      i = j - 1;
      const th = header.map((c) => `<th style="border:1px solid #cbd5e0;padding:8px;background:#2b6cb0;color:#fff;">${inlineMd(c)}</th>`).join("");
      const trs = rows.map((r, ri) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e0;padding:8px;background:${ri % 2 ? "#f7fafc" : "#fff"};">${inlineMd(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<table style="border-collapse:collapse;width:100%;margin:1.4em 0;font-size:.95em;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }

    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      const textH = inlineMd(h[2]);
      if (level === 1) {
        if (h[2].trim() === title.trim()) continue; // タイトル重複を避ける
        out.push(`<h2 ${H2}>${textH}</h2>`);
      } else if (level === 2) {
        out.push(`<h2 ${H2}>${textH}</h2>`);
      } else {
        out.push(`<h3 ${H3}>${textH}</h3>`);
      }
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushPara(); flushList(); continue; } // hr は無視

    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ul) { flushPara(); if (!list || listOrdered) { flushList(); list = []; listOrdered = false; } list.push(ul[1]); continue; }
    if (ol) { flushPara(); if (!list || !listOrdered) { flushList(); list = []; listOrdered = true; } list.push(ol[1]); continue; }

    if (trimmed === "") { flushPara(); flushList(); continue; }
    para.push(trimmed);
  }
  flushPara(); flushList();
  return out.join("\n");
}

const STEP_INSTRUCTIONS: Record<WorkflowStepKey, { model: string; schema: string; task: string }> = {
  media_analysis: {
    model: RESEARCH_MODEL,
    task: `siteContext(実際のサイト内容)・メディア名・ドメインから、このメディアが扱う事業領域/業種/読者を推定し、その領域で『検索流入が見込めるのに不足している具体的な記事テーマ』を洗い出してください。
重要:
- 推薦タイトルは必ずこのメディアの業種・事業に即した具体的なものにする（例: ホームページ制作会社なら「ホームページ制作の費用相場と内訳」等）。
- instruction はあくまで補助的な方針。instructionの文言（例:「検索流入を伸ばす記事を作る」）を記事タイトルにそのまま使ってはいけない。
- contentGaps は4〜6件、それぞれ実在しそうな具体的タイトルにする。`,
    schema: `{
  "summary": "分析サマリ(2-3文)",
  "mediaProfile": { "audience": "想定読者", "tone": "トーン", "categories": ["..."] },
  "contentGaps": [ { "title": "不足記事タイトル", "intent": "情報収集|解決策|比較検討|購買", "reason": "なぜ必要か" } ],
  "recommendedArticle": "最優先で書くべき記事タイトル",
  "rationale": "推薦理由"
}`,
  },
  keyword_research: {
    model: RESEARCH_MODEL,
    task: "推薦記事に対する主軸キーワードと候補KWを、検索意図とともに提案してください。volume/difficultyは0-100の相対推定で構いません。",
    schema: `{
  "primaryKeyword": "主軸KW",
  "candidates": [ { "keyword": "KW", "volume": 1200, "difficulty": 45, "intent": "情報収集" } ],
  "selectedReason": "主軸KW選定の理由",
  "nextResearchFocus": "次に深掘りすべきKW"
}`,
  },
  competitor_research: {
    model: RESEARCH_MODEL,
    task: "主軸KWで上位を取る競合記事の典型パターンと、それを上回るための差別化方針を提案してください。",
    schema: `{
  "keyword": "対象KW",
  "competitorPatterns": [ { "pattern": "競合の型", "strength": "強み", "gap": "弱み・抜け" } ],
  "differentiation": [ "差別化ポイント" ]
}`,
  },
  tail_keywords: {
    model: RESEARCH_MODEL,
    task: "主軸KWに紐づくロングテール(テール)KWのうち、競合に勝てそう(難易度が低く意図が明確)なものを洗い出してください。本文内での使い方も示してください。",
    schema: `{
  "parentKeyword": "主軸KW",
  "tailKeywords": [ { "keyword": "テールKW", "volume": 300, "difficulty": 25, "intent": "情報収集" } ],
  "recommendedUse": "本文での使い方"
}`,
  },
  tail_competitor_research: {
    model: RESEARCH_MODEL,
    task: "洗い出したテールKWで上位を取る競合記事の型と、それを上回るための差別化方針を提案してください。テールの検索意図に1記事で完全に答える観点で。",
    schema: `{
  "keyword": "対象テールKW",
  "competitorPatterns": [ { "pattern": "競合の型", "strength": "強み", "gap": "弱み・抜け" } ],
  "differentiation": [ "差別化ポイント" ]
}`,
  },
  article_outline: {
    model: RESEARCH_MODEL,
    task: "検索意図を満たす記事構成(タイトル・メタ・H2/H3)を作ってください。",
    schema: `{
  "title": "記事タイトル(32字前後)",
  "metaDescription": "メタ説明(120字前後)",
  "outline": [ { "h2": "見出し", "h3": ["小見出し"] } ],
  "searchIntent": "想定検索意図"
}`,
  },
  seo_requirements: {
    model: RESEARCH_MODEL,
    task: "目標文字数、KW配置、内部リンク、外部リンク、CTAなどのSEO要件を定義してください。",
    schema: `{
  "targetWordCount": { "min": 2800, "recommended": 3600, "max": 4600 },
  "keywordPlacement": ["配置箇所"],
  "internalLinks": [ { "anchor": "アンカー", "target": "/path", "reason": "理由" } ],
  "externalLinks": [ { "anchor": "リンク先の種類", "reason": "理由" } ],
  "cta": "CTA方針",
  "primaryKeyword": "主軸KW"
}`,
  },
  draft_article: {
    model: WRITING_MODEL,
    task: "これまでの構成・SEO要件に完全準拠した、公開できる品質の日本語SEO記事をMarkdownで執筆してください。E-E-A-Tを意識し、読者の検索意図を満たすこと。bodyはMarkdown本文(見出し含む)を丸ごと入れてください。",
    schema: `{
  "title": "記事タイトル",
  "estimatedWordCount": 3600,
  "format": "markdown",
  "body": "# タイトル\\n\\n本文をMarkdownで..."
}`,
  },
  swell_format: {
    model: WRITING_MODEL,
    task: `直前の記事(draft_article)を、どのWordPressテーマでもそのまま貼れる「装飾済みHTML」に変換してください。読者が視覚的に理解しやすく、飽きずに読める記事にするのが目的です。

# 厳守ルール
- CSSは必ず style 属性のインラインのみ。<style>タグ・外部CSS・classやid・JavaScriptは禁止（テーマ非依存にするため）。
- htmlは body内に貼るHTMLのみ（<html>/<head>不要）。
- 見出しは<h2>/<h3>。長い段落は避け、箇条書き・表・装飾で読みやすく分割する。
- 画像を入れる箇所に <!-- IMAGE: 画像の内容説明 --> を2〜5箇所（アイキャッチ含む）。

# 記事内容に応じて以下の装飾を適切に使う（インラインCSS例をそのまま流用可）
- 見出しh2(必ず濃い文字色を指定。テーマの白抜き対策で color は !important): <h2 style="color:#1a2b45 !important;background:#eef4fb;border-left:6px solid #2b6cb0;padding:.5em .8em;font-size:1.35em;font-weight:700;border-radius:0 6px 6px 0;">…</h2>
- 見出しh3(必ず濃い文字色を指定): <h3 style="color:#22303f !important;border-bottom:2px solid #cbd5e0;padding-bottom:.25em;font-size:1.15em;font-weight:700;">…</h3>
- マーカー(重要語): <span style="background:linear-gradient(transparent 60%,#fff3a0 60%);font-weight:700;">…</span>
- 赤文字強調: <strong style="color:#e3342f;">…</strong>
- 太字: <strong>…</strong>
- ポイント吹き出し: <div style="position:relative;margin:1.4em 0;padding:14px 16px 14px 56px;background:#eef6ff;border:1px solid #b6d4f2;border-radius:10px;"><span style="position:absolute;left:12px;top:12px;width:32px;height:32px;border-radius:50%;background:#2b6cb0;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">P</span>…吹き出しの内容…</div>
- 注意ボックス: <div style="margin:1.4em 0;padding:12px 16px;background:#fff5f5;border-left:5px solid #e3342f;border-radius:6px;"><strong style="color:#e3342f;">⚠ 注意</strong><br>…</div>
- ポイントボックス: <div style="margin:1.4em 0;padding:12px 16px;background:#f0fff4;border-left:5px solid #38a169;border-radius:6px;"><strong style="color:#2f855a;">✓ ポイント</strong><br>…</div>
- 表: <table style="border-collapse:collapse;width:100%;margin:1.4em 0;font-size:.95em;"><thead><tr><th style="border:1px solid #cbd5e0;padding:8px;background:#2b6cb0;color:#fff;">項目</th><th style="border:1px solid #cbd5e0;padding:8px;background:#2b6cb0;color:#fff;">内容</th></tr></thead><tbody><tr><td style="border:1px solid #cbd5e0;padding:8px;background:#fff;">…</td><td style="border:1px solid #cbd5e0;padding:8px;background:#fff;">…</td></tr><tr><td style="border:1px solid #cbd5e0;padding:8px;background:#f7fafc;">…</td><td style="border:1px solid #cbd5e0;padding:8px;background:#f7fafc;">…</td></tr></tbody></table>
- 簡易横棒グラフ(数値比較がある場合): <div style="margin:1.2em 0;"><div style="margin:6px 0;"><span style="display:inline-block;width:120px;">項目A</span><span style="display:inline-block;height:16px;width:70%;background:#2b6cb0;border-radius:3px;vertical-align:middle;"></span> 70%</div><div style="margin:6px 0;"><span style="display:inline-block;width:120px;">項目B</span><span style="display:inline-block;height:16px;width:40%;background:#63b3ed;border-radius:3px;vertical-align:middle;"></span> 40%</div></div>
- チェックリスト: <ul style="list-style:none;padding-left:0;"><li style="padding:4px 0;">✅ …</li></ul>

装飾は過剰にならないよう、要点・比較・注意点など効果的な箇所に絞って使うこと。`,
    schema: `{
  "title": "記事タイトル",
  "format": "html",
  "html": "<h2 style=\\"..\\">..</h2>\\n<!-- IMAGE: アイキャッチ.. -->\\n<p>..<span style=\\"..\\">..</span>..</p>",
  "imageComments": ["アイキャッチの説明", "図解の説明"]
}`,
  },
  image_prompts: {
    model: RESEARCH_MODEL,
    task: `gpt-image-1で生成する画像プロンプトを作ります。1枚目はアイキャッチ(サムネイル)、2枚目以降は本文中の補助ビジュアルです。

# アイキャッチ(eyecatch) … 最重要。思わずクリックしたくなる魅力的なサムネイルにする
- mainText: 画像に大きく載せる短い日本語タイトル。記事タイトル(previousSteps.draft_articleのtitle)を魅力的に凝縮し、20字以内・簡潔で目を引く言葉にする。
- subText: mainTextを補う短い日本語キャッチ(15字以内・任意)。ベネフィットや数字・「事例」「完全ガイド」等の訴求語を入れると良い。
- style: 記事の内容・トーンに応じて 'illustration'(親しみやすい/概念的/BtoC寄り) か 'photo'(信頼感/専門的/実務・法律・医療・金融など) を臨機応変に選ぶ。
- prompt: 上記スタイルの、プロのブログサムネイル/OGPバナーとしての背景・装飾・構図・配色を指示する英語プロンプト。記事内容に合ったアイコンや象徴的モチーフ、視認性の高い配色、余白と重心のあるレイアウトにする(文字自体はmainText/subTextで別途大きく描画する)。

# 本文画像(images) … imageComments(2枚目以降)に対応
- 文字は入れない。清潔でモダンな編集向けビジュアル。記事内容に応じて illustration か photo を選ぶ。`,
    schema: `{
  "eyecatch": {
    "style": "illustration|photo",
    "mainText": "画像に大きく載せる短いタイトル(20字以内)",
    "subText": "補助キャッチ(15字以内・任意)",
    "prompt": "English prompt for background/decoration/composition (do not describe text; text is drawn separately)"
  },
  "images": [ { "index": 1, "comment": "元のコメント", "prompt": "English image generation prompt, no text in image, illustration or photo as fits" } ]
}`,
  },
};

export interface StepUsage {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}
export interface StepRun {
  output: Record<string, unknown>;
  usage: StepUsage;
  aiError?: string; // AI呼び出しが例外で失敗した場合のメッセージ（テンプレ雛形を成果物として出さないための目印）
}

const ZERO_USAGE: StepUsage = { model: "template", provider: "none", inputTokens: 0, outputTokens: 0 };

export async function runStepWithAI(
  key: WorkflowStepKey,
  context: StepContext
): Promise<StepRun> {
  // キー未設定ならテンプレ生成にフォールバック（トークン消費なし）
  if (!aiEnabled()) {
    return { output: generateStepOutput(key, context) as Record<string, unknown>, usage: ZERO_USAGE };
  }

  const spec = STEP_INSTRUCTIONS[key];
  const revision = context.steps.find((step) => step.key === key)?.revisionNote;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // swell_format はHTMLをJSONに包まず生で扱う（二重引用符だらけでJSON.parseが壊れるのを回避）
  if (key === "swell_format") {
    return runSwellFormat(context, client, revision ?? null);
  }

  const system = `あなたはSEOとコンテンツ戦略に精通した日本語のSEOアナリスト兼ライターです。
与えられたメディアと、これまでのステップ出力を踏まえて、次のタスクを実行します。
必ず指定されたJSONスキーマに厳密に従い、JSON以外のテキスト(説明・前置き・コードフェンス)は一切出力しないでください。`;

  // メディア分析では実サイトの内容を取得して材料にする
  const siteContext = key === "media_analysis" ? await fetchSiteContext(context.media) : null;
  // 既存記事/カテゴリ（不足記事の特定・実在する内部リンクに使用）
  const wpContext = key === "media_analysis" || key === "seo_requirements" ? await fetchWpContext(context.media) : null;

  const payload = {
    media: {
      name: context.media.name,
      domain: context.media.domain,
      description: context.media.description,
      audience: context.media.audience,
      tone: context.media.tone,
      categories: mediaCategories(context.media),
    },
    siteContext,
    wpContext,
    instruction: context.instruction,
    targetTheme: context.targetTheme ?? null,
    targetWordCount: context.targetWordCount ?? null,
    previousSteps: priorOutputs(context),
    revisionNote: revision ?? null,
  };

  // 既存記事情報の活用指示
  const wpNote = wpContext
    ? key === "media_analysis"
      ? `\n# 既存記事の活用(必須)\npayload.wpContext.existingArticles が公開済みの既存記事一覧です。これらと内容が重複する記事は提案しないこと。既存カテゴリ(payload.wpContext.categories)の文脈に沿って、まだ無い不足テーマだけを contentGaps / recommendedArticle にすること。\n`
      : `\n# 内部リンクは実在URLのみ(必須)\ninternalLinks の target には、payload.wpContext.existingArticles に実在する記事の url を使うこと（架空の /path を作らない）。テーマに関連する既存記事を2〜4本選び、anchor は自然な日本語アンカーにする。\n`
    : "";

  // 文字数指定がある場合、要件定義と執筆で必ず反映させる
  const wc = context.targetWordCount && context.targetWordCount > 0 ? context.targetWordCount : null;
  const wordCountNote = wc && (key === "seo_requirements" || key === "draft_article")
    ? key === "draft_article"
      ? `\n# 文字数の指定(必ず厳守)\n本文の文字数は約${wc}字（±10%以内）にすること。情報を薄めず、具体例・データ・手順で密度を上げて指定文字数に到達させる。目安を大きく下回らないこと。\n`
      : `\n# 文字数の指定(必ず反映)\ntargetWordCount.recommended は ${wc} にし、min/max もその前後（min=約${Math.round(wc * 0.9)}, max=約${Math.round(wc * 1.15)}）に設定すること。\n`
    : "";

  const user = `# タスク
${spec.task}${wordCountNote}${wpNote}
${revision ? `\n# 修正指示(必ず反映)\n${revision}\n` : ""}
# 入力データ
${JSON.stringify(payload, null, 2)}

# 出力JSONスキーマ(このキー構造に厳密に従う)
${spec.schema}

JSONのみを出力してください。`;

  try {
    const isWriting = spec.model === WRITING_MODEL;
    const maxTokens = isWriting ? writingMaxTokens(wc) : 2000;
    let text = "";
    let usage: StepUsage = { model: spec.model, provider: "anthropic", inputTokens: 0, outputTokens: 0 };
    if (isWriting) {
      // 執筆は長文＆max_tokensが大きくなるためstreamで受ける（"Streaming is required"回避）
      const stream = client.messages.stream({ model: spec.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      const final = await stream.finalMessage();
      text = final.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("");
      usage = { model: spec.model, provider: "anthropic", inputTokens: final.usage?.input_tokens ?? 0, outputTokens: final.usage?.output_tokens ?? 0 };
    } else {
      const msg = await client.messages.create({ model: spec.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
      usage = { model: spec.model, provider: "anthropic", inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 };
    }
    const json = extractJson(text);
    if (json && typeof json === "object") {
      return { output: { ...(json as Record<string, unknown>), revisionApplied: revision ?? null, _engine: "ai" }, usage };
    }
    // パース失敗 → テンプレにフォールバック（ただしトークンは消費済みなので計上する）
    return { output: { ...(generateStepOutput(key, context) as Record<string, unknown>), _engine: "template_fallback" }, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ai_failed";
    return {
      output: {
        ...(generateStepOutput(key, context) as Record<string, unknown>),
        _engine: "template_fallback",
        _error: message,
      },
      usage: ZERO_USAGE,
      aiError: message,
    };
  }
}

// swell_format 専用：draft_articleのMarkdownを「装飾済みHTML」に変換する。
// JSONに包まず生HTMLで受け取り、失敗時はMarkdownを決定的にHTML化して本文を必ず残す。
async function runSwellFormat(
  context: StepContext,
  client: Anthropic,
  revision: string | null
): Promise<StepRun> {
  const draft = context.steps.find((s) => s.key === "draft_article")?.output as
    | { title?: string; body?: string }
    | undefined;
  const title = (draft?.title ?? context.targetTheme ?? context.media.name).trim();
  const markdown = (draft?.body ?? "").trim();

  // 執筆本文が無ければテンプレにフォールバック
  if (!markdown) {
    const tmpl = generateStepOutput("swell_format", context) as Record<string, unknown>;
    return { output: { ...tmpl, _engine: "template_fallback", _error: "no_draft_body" }, usage: ZERO_USAGE };
  }

  const spec = STEP_INSTRUCTIONS.swell_format;
  const system = `あなたは日本語SEO記事のHTMLコーダーです。与えられたMarkdown記事を、どのWordPressテーマでも崩れない「装飾済みHTML」に変換します。
出力はHTMLのみ。JSON・コードフェンス(\`\`\`)・前置き・後書き・説明文は一切出力しないでください。本文の情報は省略・要約せず、すべてHTMLに反映してください。`;

  const user = `# タスク
${spec.task}
${revision ? `\n# 修正指示(必ず反映)\n${revision}\n` : ""}
# 変換元の記事(Markdown)
タイトル: ${title}

${markdown}

# 出力
上記Markdownを装飾済みHTML(body内に貼る形)へ変換し、HTMLだけを出力してください。見出し・表・箇条書き・重要箇所の装飾を活かし、本文は省略しないこと。`;

  try {
    const stream = client.messages.stream({
      model: WRITING_MODEL,
      max_tokens: 32000, // 装飾HTML(インラインCSS)は冗長なので大きめ。streamなので大kも可
      system,
      messages: [{ role: "user", content: user }],
    });
    const final = await stream.finalMessage();
    const raw = final.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");
    const usage: StepUsage = {
      model: WRITING_MODEL,
      provider: "anthropic",
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
    };

    let html = stripCodeFence(raw);
    const textLen = html.replace(/<[^>]+>/g, "").trim().length;
    const hasStructure = /<(h2|h3|table|ul|ol|p)[\s>]/i.test(html);
    // max_tokens 打ち切り=末尾が途切れている恐れ → 決定的変換に切替（本文を完全に残す）
    const truncated = final.stop_reason === "max_tokens";
    const engineOk = Boolean(html) && hasStructure && textLen >= 200 && !truncated;
    if (!engineOk) {
      html = markdownToHtml(markdown, title); // 不十分/途切れ → 決定的変換で本文を担保
    }
    html = ensureHeadingColor(ensureEyecatch(html, title));
    return {
      output: {
        title,
        format: "html",
        html,
        imageComments: extractImageComments(html),
        revisionApplied: revision,
        _engine: engineOk ? "ai" : "md_fallback",
      },
      usage,
    };
  } catch (error) {
    const html = ensureHeadingColor(ensureEyecatch(markdownToHtml(markdown, title), title));
    return {
      output: {
        title,
        format: "html",
        html,
        imageComments: extractImageComments(html),
        revisionApplied: revision,
        _engine: "md_fallback",
        _error: error instanceof Error ? error.message : "ai_failed",
      },
      usage: ZERO_USAGE,
    };
  }
}
