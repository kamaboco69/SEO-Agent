import type { Media, WorkflowStep } from "@prisma/client";

export const workflowSteps = [
  { key: "media_analysis", label: "メディア分析・不足記事洗い出し" },
  { key: "keyword_research", label: "記事KW調査" },
  { key: "competitor_research", label: "競合調査" },
  { key: "tail_keywords", label: "勝てるテールKW洗い出し" },
  { key: "tail_competitor_research", label: "テールKWで競合調査" },
  { key: "article_outline", label: "勝てる記事構成提案" },
  { key: "seo_requirements", label: "文字数・内部リンク・外部リンク提案" },
  { key: "draft_article", label: "記事執筆" },
  { key: "swell_format", label: "WordPress装飾HTML整形＋画像挿入コメント" },
  { key: "image_prompts", label: "画像生成プロンプト付与" },
] as const;

export type WorkflowStepKey = (typeof workflowSteps)[number]["key"];

type StepContext = {
  media: Pick<Media, "name" | "domain" | "description" | "audience" | "tone" | "mainCategories">;
  instruction: string;
  targetTheme?: string | null;
  steps: Pick<WorkflowStep, "key" | "output" | "revisionNote">[];
};

function baseTopic(context: StepContext) {
  return (
    context.targetTheme?.trim() ||
    context.instruction
      .replace(/記事|作成|書いて|ください|したい|について/g, "")
      .trim()
      .slice(0, 28) ||
    context.media.name
  );
}

function categories(media: StepContext["media"]) {
  return Array.isArray(media.mainCategories)
    ? media.mainCategories.map(String).filter(Boolean)
    : [];
}

function prior<T>(context: StepContext, key: WorkflowStepKey): T | null {
  const step = context.steps.find((item) => item.key === key);
  return (step?.output as T | undefined) ?? null;
}

function metric(keyword: string) {
  const len = Math.max(keyword.length, 1);
  const volume = Math.max(80, Math.round(9200 / Math.pow(len, 0.72)));
  const difficulty = Math.min(92, Math.round(24 + len * 1.7));
  const intent = keyword.includes("比較") || keyword.includes("おすすめ")
    ? "比較検討"
    : keyword.includes("料金") || keyword.includes("導入")
      ? "購買"
      : keyword.includes("方法") || keyword.includes("手順")
        ? "解決策"
        : "情報収集";
  return { keyword, volume, difficulty, intent };
}

export function nextStepKey(currentKey: string) {
  const index = workflowSteps.findIndex((step) => step.key === currentKey);
  return workflowSteps[index + 1]?.key ?? null;
}

export function stepLabel(key: string) {
  return workflowSteps.find((step) => step.key === key)?.label ?? key;
}

export function generateStepOutput(key: WorkflowStepKey, context: StepContext) {
  const topic = baseTopic(context);
  const mediaCategories = categories(context.media);
  const revision = context.steps.find((step) => step.key === key)?.revisionNote;

  if (key === "media_analysis") {
    const categoryHint = mediaCategories.length > 0 ? mediaCategories.join(" / ") : "主要カテゴリ未設定";
    return {
      summary: `${context.media.name}（${context.media.domain}）向けに「${topic}」周辺の記事群を分析します。`,
      mediaProfile: {
        audience: context.media.audience || "未設定",
        tone: context.media.tone || "未設定",
        categories: mediaCategories,
      },
      contentGaps: [
        { title: `${topic}とは？基礎からわかる完全ガイド`, intent: "情報収集", reason: "検索初期層を受け止める入口記事が必要" },
        { title: `${topic}の導入手順と失敗しない進め方`, intent: "解決策", reason: "実行段階の読者に刺さる実務記事が不足しやすい" },
        { title: `${topic}のおすすめ比較と選び方`, intent: "比較検討", reason: "比較・検討KWはCV導線に接続しやすい" },
        { title: `${topic}の料金・費用相場`, intent: "購買", reason: "商談前の不安を解消する記事が必要" },
      ],
      recommendedArticle: `${topic}とは？基礎からわかる完全ガイド`,
      rationale: `${categoryHint}の文脈で、まずは検索意図が広く内部リンクの起点にしやすい記事から着手します。`,
      revisionApplied: revision ?? null,
    };
  }

  if (key === "keyword_research") {
    const mediaAnalysis = prior<{ recommendedArticle?: string }>(context, "media_analysis");
    const primary = mediaAnalysis?.recommendedArticle?.replace(/とは.*$/, "").replace(/の.*/, "") || topic;
    const candidates = [
      primary,
      `${primary} とは`,
      `${primary} 方法`,
      `${primary} 始め方`,
      `${primary} 比較`,
      `${primary} 料金`,
      `${primary} おすすめ`,
      `${primary} 事例`,
    ].map(metric);
    return {
      primaryKeyword: candidates[1].keyword,
      candidates,
      selectedReason: "情報収集KWで入口を作り、後続の比較・料金記事へ内部リンクで流す設計がしやすい。",
      nextResearchFocus: `${primary} 比較`,
      revisionApplied: revision ?? null,
    };
  }

  if (key === "competitor_research") {
    const keyword = prior<{ primaryKeyword?: string }>(context, "keyword_research")?.primaryKeyword ?? `${topic} とは`;
    return {
      keyword,
      competitorPatterns: [
        { pattern: "網羅型ガイド", strength: "見出し数が多く初学者向けに強い", gap: "実務判断や導入後の運用が浅い" },
        { pattern: "比較記事", strength: "商標・サービス名の比較でCVに近い", gap: "中立性と選定基準の説明が弱い" },
        { pattern: "事例記事", strength: "導入後イメージを作りやすい", gap: "KW網羅性が不足しやすい" },
      ],
      differentiation: [
        "読者の状況別に判断基準を分ける",
        "導入前・導入中・運用後のチェックリストを入れる",
        "内部リンクで比較/料金/事例記事へ自然に誘導する",
      ],
      revisionApplied: revision ?? null,
    };
  }

  if (key === "tail_keywords") {
    const keyword = prior<{ primaryKeyword?: string }>(context, "keyword_research")?.primaryKeyword ?? `${topic} とは`;
    return {
      parentKeyword: keyword,
      tailKeywords: [
        metric(`${keyword} 初心者`),
        metric(`${keyword} メリット デメリット`),
        metric(`${keyword} 導入 手順`),
        metric(`${keyword} 失敗例`),
        metric(`${keyword} チェックリスト`),
        metric(`${keyword} 比較`),
        metric(`${keyword} 費用`),
      ],
      recommendedUse: "H2/H3とFAQに分散して自然に含め、別記事化できるものは内部リンク候補にします。",
      revisionApplied: revision ?? null,
    };
  }

  if (key === "article_outline") {
    const keyword = prior<{ primaryKeyword?: string }>(context, "keyword_research")?.primaryKeyword ?? `${topic} とは`;
    return {
      title: `${keyword}を基礎から解説｜導入前に知るべき判断基準`,
      metaDescription: `${keyword}について、基礎知識、メリット・デメリット、導入手順、失敗しない判断基準までわかりやすく解説します。`,
      outline: [
        { h2: `${keyword}とは`, h3: ["基本概念", "注目される背景"] },
        { h2: `${keyword}で解決できる課題`, h3: ["よくある課題", "向いているケース"] },
        { h2: "メリット・デメリット", h3: ["主なメリット", "注意すべきデメリット"] },
        { h2: "導入手順", h3: ["準備", "実行", "運用改善"] },
        { h2: "失敗しない選び方", h3: ["比較基準", "チェックリスト"] },
        { h2: "よくある質問", h3: ["費用", "期間", "社内体制"] },
      ],
      searchIntent: "初学者から導入検討層までを受け止める情報収集記事",
      revisionApplied: revision ?? null,
    };
  }

  if (key === "seo_requirements") {
    const keyword = prior<{ primaryKeyword?: string }>(context, "keyword_research")?.primaryKeyword ?? `${topic} とは`;
    return {
      targetWordCount: { min: 2800, recommended: 3600, max: 4600 },
      keywordPlacement: [
        "titleの前半",
        "導入文の100字以内",
        "最初のH2",
        "FAQの質問文",
      ],
      internalLinks: [
        { anchor: `${topic} 比較`, target: "/comparison", reason: "比較検討層へ送客" },
        { anchor: `${topic} 料金`, target: "/pricing", reason: "購買意図に接続" },
        { anchor: `${topic} 事例`, target: "/case-studies", reason: "導入後イメージを補強" },
      ],
      externalLinks: [
        { anchor: "公的統計・業界レポート", reason: "信頼性補強" },
        { anchor: "一次情報または公式ドキュメント", reason: "根拠の明示" },
      ],
      cta: `${context.media.name}内の関連サービス・資料請求導線へ接続`,
      primaryKeyword: keyword,
      revisionApplied: revision ?? null,
    };
  }

  if (key === "tail_competitor_research") {
    const tail = prior<{ tailKeywords?: { keyword: string }[] }>(context, "tail_keywords");
    const kw = tail?.tailKeywords?.[0]?.keyword ?? `${topic} 比較`;
    return {
      keyword: kw,
      competitorPatterns: [
        { pattern: "テール特化記事", strength: "意図が明確でCVに近い", gap: "網羅性・一次情報が弱い" },
        { pattern: "まとめ記事内の一節", strength: "ドメインが強い", gap: "テール意図への解像度が低い" },
      ],
      differentiation: [
        "テール意図に1記事で完全に答える",
        "具体例・チェックリスト・FAQで深さを出す",
      ],
      revisionApplied: revision ?? null,
    };
  }

  if (key === "swell_format") {
    const draft = prior<{ title?: string; body?: string }>(context, "draft_article");
    const title = draft?.title ?? `${topic}を基礎から解説`;
    const html = [
      `<h1>${title}</h1>`,
      `<!-- 画像挿入: アイキャッチ。${title} を象徴するビジュアル -->`,
      `<p>${topic}について、基礎から実践までを整理します。</p>`,
    ].join("\n");
    return { title, format: "html-swell", html, imageComments: [`アイキャッチ。${title} を象徴するビジュアル`], revisionApplied: revision ?? null };
  }

  if (key === "image_prompts") {
    const swell = prior<{ imageComments?: string[] }>(context, "swell_format");
    const comments = swell?.imageComments ?? [`${topic} のアイキャッチ`];
    return {
      images: comments.map((c, i) => ({
        index: i,
        comment: c,
        prompt: `A clean, modern editorial illustration for a Japanese SEO article about ${topic}. ${c}. Flat design, soft colors, no text.`,
      })),
      revisionApplied: revision ?? null,
    };
  }

  const outline = prior<{ title?: string; outline?: { h2: string; h3: string[] }[] }>(context, "article_outline");
  const requirements = prior<{ primaryKeyword?: string; targetWordCount?: { recommended: number } }>(context, "seo_requirements");
  const title = outline?.title ?? `${topic}を基礎から解説`;
  const headings = outline?.outline ?? [];
  return {
    title,
    estimatedWordCount: requirements?.targetWordCount?.recommended ?? 3600,
    format: "markdown",
    body: [
      `# ${title}`,
      "",
      `${requirements?.primaryKeyword ?? topic}は、導入前の理解と運用設計で成果が大きく変わります。本記事では、基本概念から判断基準、導入手順までを整理します。`,
      "",
      ...headings.flatMap((section) => [
        `## ${section.h2}`,
        `${section.h2}では、読者が次の意思決定に進むために必要な前提を整理します。`,
        ...section.h3.map((h3) => `### ${h3}\n${h3}の観点から、実務で確認すべきポイントと注意点を解説します。`),
        "",
      ]),
      "## まとめ",
      `${context.media.name}でこの記事を公開する場合は、比較・料金・事例記事への内部リンクを設置し、読者の検討段階に合わせた導線を作ることが重要です。`,
    ].join("\n"),
    revisionApplied: revision ?? null,
  };
}
