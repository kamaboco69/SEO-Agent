import Anthropic from "@anthropic-ai/sdk";
import type { Media, WorkflowStep } from "@prisma/client";
import { generateStepOutput, type WorkflowStepKey } from "@/lib/contentWorkflow";

// 一気通貫パイプラインの各ステップを「本物のAI」で実行する。
// ANTHROPIC_API_KEY 未設定時は contentWorkflow.ts のテンプレ生成にフォールバックする。

const WRITING_MODEL = "claude-sonnet-4-6"; // 記事執筆
const RESEARCH_MODEL = "claude-haiku-4-5-20251001"; // メディア分析・KW・競合などの調査系

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type StepContext = {
  media: Pick<Media, "name" | "domain" | "description" | "audience" | "tone" | "mainCategories" | "wpUrl">;
  instruction: string;
  targetTheme?: string | null;
  steps: Pick<WorkflowStep, "key" | "output" | "revisionNote">[];
};

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
- 見出しh2: <h2 style="border-left:6px solid #2b6cb0;padding:.4em .6em;background:#f2f7fc;font-size:1.4em;">…</h2>
- 見出しh3: <h3 style="border-bottom:2px solid #cbd5e0;padding-bottom:.2em;">…</h3>
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
    task: "swell_formatのimageComments(各<!-- IMAGE: .. -->)それぞれに対し、gpt-image-1で生成するための英語の画像生成プロンプトを作ってください。記事テーマに沿い、文字を含まない清潔でモダンな編集向けビジュアルにすること。",
    schema: `{
  "images": [ { "index": 0, "comment": "元のコメント", "prompt": "English image generation prompt, no text in image" } ]
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

  const system = `あなたはSEOとコンテンツ戦略に精通した日本語のSEOアナリスト兼ライターです。
与えられたメディアと、これまでのステップ出力を踏まえて、次のタスクを実行します。
必ず指定されたJSONスキーマに厳密に従い、JSON以外のテキスト(説明・前置き・コードフェンス)は一切出力しないでください。`;

  // メディア分析では実サイトの内容を取得して材料にする
  const siteContext = key === "media_analysis" ? await fetchSiteContext(context.media) : null;

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
    instruction: context.instruction,
    targetTheme: context.targetTheme ?? null,
    previousSteps: priorOutputs(context),
    revisionNote: revision ?? null,
  };

  const user = `# タスク
${spec.task}
${revision ? `\n# 修正指示(必ず反映)\n${revision}\n` : ""}
# 入力データ
${JSON.stringify(payload, null, 2)}

# 出力JSONスキーマ(このキー構造に厳密に従う)
${spec.schema}

JSONのみを出力してください。`;

  try {
    const isWriting = spec.model === WRITING_MODEL;
    const msg = await client.messages.create({
      model: spec.model,
      max_tokens: isWriting ? 8000 : 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const usage: StepUsage = {
      model: spec.model,
      provider: "anthropic",
      inputTokens: msg.usage?.input_tokens ?? 0,
      outputTokens: msg.usage?.output_tokens ?? 0,
    };
    const json = extractJson(text);
    if (json && typeof json === "object") {
      return { output: { ...(json as Record<string, unknown>), revisionApplied: revision ?? null, _engine: "ai" }, usage };
    }
    // パース失敗 → テンプレにフォールバック（ただしトークンは消費済みなので計上する）
    return { output: { ...(generateStepOutput(key, context) as Record<string, unknown>), _engine: "template_fallback" }, usage };
  } catch (error) {
    return {
      output: {
        ...(generateStepOutput(key, context) as Record<string, unknown>),
        _engine: "template_fallback",
        _error: error instanceof Error ? error.message : "ai_failed",
      },
      usage: ZERO_USAGE,
    };
  }
}
