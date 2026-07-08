import { NextRequest, NextResponse } from "next/server";
import type { ContentWorkflow, WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps, type WorkflowStepKey } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { getAiCompanyEntitlement, getCurrentUser, reportAiCompanyUsage, saveGoogleDoc } from "@/lib/auth";
import { wpUpsertPost, wpUploadImage } from "@/lib/wordpress";
import { generateImage, imageGenEnabled } from "@/lib/openaiImage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 一気通貫はAICompany有料契約者限定。未契約なら 403 + 課金導線を返す。
async function guardEntitlement() {
  const user = await getCurrentUser();
  if (!user) {
    return { res: NextResponse.json({ error: "ログインが必要です", entitled: false }, { status: 401 }) };
  }
  const ent = await getAiCompanyEntitlement(user.id, user.email);
  if (!ent.entitled) {
    return {
      res: NextResponse.json(
        {
          error: ent.found
            ? "この機能はAICompanyの有料プラン契約者のみ利用できます"
            : "AICompanyアカウントとの連携が必要です",
          entitled: false,
          found: ent.found,
          billingUrl: ent.billingUrl,
        },
        { status: 403 }
      ),
    };
  }
  return { user };
}

function includeWorkflow() {
  return {
    media: { include: { project: { select: { id: true, name: true, domain: true } } } },
    steps: { orderBy: { createdAt: "asc" as const } },
  };
}

function hasOutput(step: { output: unknown }) {
  return Boolean(step.output && typeof step.output === "object" && Object.keys(step.output as object).length > 0);
}

// AI失敗を利用者向けの分かりやすいメッセージに変換（テンプレ雛形を成果物として出さないため停止する）
function aiErrorMessage(raw: string): string {
  if (/credit balance is too low/i.test(raw)) {
    return "AI（Anthropic）のクレジット残高が不足しているため生成できません。AnthropicのPlansでチャージするとAIが動きます。";
  }
  if (/rate.?limit|overloaded|429|529/i.test(raw)) {
    return "AIが混雑しています。少し時間をおいて再実行してください。";
  }
  if (/invalid|authentication|api key|401|403/i.test(raw)) {
    return "AIキーの認証に失敗しました。設定を確認してください。";
  }
  return "AIの実行に失敗しました（" + raw.slice(0, 160) + "）。";
}

type WfWithSteps = ContentWorkflow & { steps: WorkflowStep[] };

type EyecatchSpec = { style?: string; mainText?: string; subText?: string; prompt?: string };

// アイキャッチ用プロンプト：記事タイトル文字を大きく載せ、内容に応じてイラスト/写真を選び、クリックしたくなる装飾に。
function buildEyecatchPrompt(title: string, comment: string, ec: EyecatchSpec): string {
  const mainText = (ec.mainText || title || comment || "").replace(/["]/g, "").trim().slice(0, 30);
  const style = ec.style === "photo"
    ? "high-quality photorealistic professional photography style, natural lighting, depth"
    : "clean modern flat vector illustration style, crisp shapes";
  const sub = ec.subText ? `Add smaller secondary Japanese catch copy: "${ec.subText.replace(/["]/g, "")}". ` : "";
  const concept = ec.prompt ? `Background/motif: ${ec.prompt}. ` : (comment ? `Theme: ${comment}. ` : "");
  return (
    `A highly click-worthy Japanese blog article thumbnail / OGP header banner, landscape 3:2 composition, ${style}. ` +
    `Render the Japanese headline text "${mainText}" LARGE, bold and perfectly legible as the clear focal point, spelled exactly and correctly with beautiful Japanese typography. ` +
    sub +
    concept +
    `Professional editorial design: tasteful decorative accents, relevant icons/motifs to the topic, strong color contrast and readability, balanced layout with generous margins, trustworthy and eye-catching so viewers want to click. ` +
    `Only display the specified Japanese text — no gibberish, no random letters, no watermark.`
  );
}

// HTML内の <!-- IMAGE: 説明 --> を、gpt-image-1生成→WordPressアップロード→<img>で置換する。
// 1枚目はアイキャッチ（タイトル文字入り・高品質・featured）。2枚目以降は本文中の補助ビジュアル。
async function buildHtmlWithImages(
  workflow: WfWithSteps & { steps: WorkflowStep[] },
  wpUrl: string,
  secret: string,
  baseHtml: string,
  postId: number
): Promise<{ html: string; count: number }> {
  if (!imageGenEnabled()) return { html: baseHtml, count: 0 };

  const ip = workflow.steps.find((s) => s.key === "image_prompts");
  const ipOut = (ip?.output ?? {}) as {
    images?: { prompt?: string; comment?: string }[];
    eyecatch?: EyecatchSpec;
  };
  const bodyImages = ipOut.images ?? [];
  const eyecatch = ipOut.eyecatch ?? {};
  const swellTitle = ((workflow.steps.find((s) => s.key === "swell_format")?.output ?? {}) as { title?: string }).title;
  const title = workflow.finalArticleTitle ?? swellTitle ?? "";

  const commentRe = /<!--\s*IMAGE:\s*([\s\S]*?)-->/g;
  const matches = [...baseHtml.matchAll(commentRe)].slice(0, 5); // 最大5枚
  let html = baseHtml;
  let count = 0;

  for (let i = 0; i < matches.length; i++) {
    const comment = matches[i][1].trim();
    const isEyecatch = i === 0;
    const prompt = isEyecatch
      ? buildEyecatchPrompt(title, comment, eyecatch)
      : (bodyImages[i - 1]?.prompt || bodyImages[i]?.prompt
          || `Clean, modern editorial illustration or photograph (choose what fits) for a Japanese article. ${comment}. Tasteful, professional, no text.`);
    const img = await generateImage(prompt, "1536x1024", isEyecatch ? "high" : "medium");
    if (!img) continue;
    const up = await wpUploadImage(wpUrl, secret, {
      filename: `seo-${postId}-${i + 1}.png`,
      base64: img.base64,
      postId,
      setFeatured: isEyecatch,
    });
    if (!up.url) continue;
    if (isEyecatch) {
      // アイキャッチ（テーマが記事先頭に自動表示）は本文へ挿入せずコメントだけ除去して重複を防ぐ。
      html = html.replace(matches[i][0], "");
    } else {
      const altText = comment.replace(/"/g, "");
      // 背景と同化しないよう影＋薄い枠線で境界を出す
      const figure = `<figure style="margin:1.8em 0;text-align:center;"><img src="${up.url}" alt="${altText}" style="max-width:100%;height:auto;border-radius:10px;box-shadow:0 6px 20px rgba(15,23,42,.15);border:1px solid #e5e9f0;" /></figure>`;
      html = html.replace(matches[i][0], figure);
    }
    count += 1;
  }
  return { html, count };
}

// フリー執筆（メディアなし）用の仮想メディア。AIステップのコンテキストとして使う。
function virtualMedia(wf: { clientName: string | null; clientSite: string | null }) {
  const host = wf.clientSite
    ? wf.clientSite.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()
    : "";
  return {
    name: wf.clientName?.trim() || "フリー執筆",
    domain: host,
    description: null,
    audience: null,
    tone: null,
    mainCategories: [] as never,
    wpUrl: wf.clientSite?.trim() || null,
    wpSecret: null,
  };
}

// 未生成の最初のAIステップ
function firstPendingStep(wf: WfWithSteps) {
  return workflowSteps
    .map((s) => wf.steps.find((st) => st.key === s.key))
    .find((st) => st && !hasOutput(st));
}

// 全自動：AIステップが残る、またはWP下書き保存が未実施なら in_progress。それ以外は completed。
function computeStatus(wf: WfWithSteps & { media?: { wpUrl?: string | null; wpSecret?: string | null } | null }): "in_progress" | "completed" {
  if (firstPendingStep(wf)) return "in_progress";
  const wpConnected = Boolean(wf.media?.wpUrl && wf.media?.wpSecret);
  if (wpConnected && !wf.wpPostId) return "in_progress"; // WP自動保存が残っている
  return "completed";
}

// GET: 一覧 or 単体
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  const freeform = req.nextUrl.searchParams.get("freeform") === "1";
  if (id) {
    const wf = await prisma.contentWorkflow.findUnique({ where: { id }, include: includeWorkflow() });
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(wf);
  }
  const workflows = await prisma.contentWorkflow.findMany({
    where: freeform ? { mediaId: null } : mediaId ? { mediaId } : undefined,
    orderBy: { updatedAt: "desc" },
    include: includeWorkflow(),
  });
  return NextResponse.json(workflows);
}

// POST: 開始（ワークフロー作成 + メディア分析を実行 → おすすめ記事の選択待ちへ）
export async function POST(req: NextRequest) {
  const guard = await guardEntitlement();
  if (guard.res) return guard.res;
  const email = guard.user!.email;

  const body = await req.json();
  const mediaId = String(body.mediaId ?? "").trim();
  const instruction = String(body.instruction ?? "").trim() || "このメディアの検索流入を伸ばす記事を作る";
  const targetTheme = body.targetTheme ? String(body.targetTheme).trim() : null;
  const rawWc = Number(body.targetWordCount);
  const targetWordCount = Number.isFinite(rawWc) && rawWc > 0 ? Math.min(20000, Math.round(rawWc)) : null;
  const freeform = Boolean(body.freeform);
  if (!mediaId && !freeform) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  const pre = await reportAiCompanyUsage(email);
  if (pre.ok && !pre.allowed) {
    return NextResponse.json(
      { error: pre.reason ?? "今月のトークン上限に達しています", overLimit: true, usedTokens: pre.usedTokens, limit: pre.limit },
      { status: 402 }
    );
  }

  // フリー執筆（メディアなし・単発依頼）：メディア分析をスキップし、指定テーマで直接執筆に入る。
  // WordPressには保存せず、執筆完了時にGoogleドキュメントへ保存される。
  if (freeform) {
    const theme = targetTheme;
    if (!theme) return NextResponse.json({ error: "テーマ・キーワードを入力してください" }, { status: 400 });
    const clientName = body.clientName ? String(body.clientName).trim() : null;
    const clientSite = body.clientSite ? String(body.clientSite).trim() : null;
    const freeInstruction = String(body.instruction ?? "").trim() || `「${theme}」について、検索上位を狙える記事を書く`;

    const workflow = await prisma.contentWorkflow.create({
      data: {
        clientName,
        clientSite,
        instruction: freeInstruction,
        targetTheme: theme,
        targetWordCount,
        selectedArticle: theme,
        automationMode: "staged",
        status: "in_progress",
        currentStep: "keyword_research",
        steps: {
          create: workflowSteps.map((step) => ({
            key: step.key,
            label: step.label,
            status: step.key === "media_analysis" ? "done" : "pending",
            input: { instruction: freeInstruction, targetTheme: theme },
            output: (step.key === "media_analysis"
              ? {
                  summary: `フリー執筆モード：テーマ「${theme}」で直接執筆します。${clientName ? `（依頼元: ${clientName}）` : ""}`,
                  recommendedArticle: theme,
                  rationale: "メディア分析をスキップし、指定テーマをそのまま採用",
                  _engine: "freeform",
                }
              : {}) as never,
          })),
        },
      },
      include: includeWorkflow(),
    });
    return NextResponse.json(workflow, { status: 201 });
  }

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  const first = await runStepWithAI("media_analysis", { media, instruction, targetTheme, targetWordCount, steps: [] });
  await reportAiCompanyUsage(email, first.usage);

  // AIが動いていない（残高不足等）なら、雛形記事を作らずここで停止して原因を返す
  if (first.aiError) {
    return NextResponse.json({ error: aiErrorMessage(first.aiError), aiFailed: true }, { status: 502 });
  }

  // おすすめ記事を自動採用（人間選択ゲートは廃止）。分析の推薦記事を以降の対象にする。
  const recommended = (first.output as { recommendedArticle?: string }).recommendedArticle ?? targetTheme ?? null;

  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId,
      instruction,
      targetTheme: recommended ?? targetTheme,
      targetWordCount,
      selectedArticle: recommended,
      automationMode: "staged",
      status: "in_progress",
      currentStep: "keyword_research",
      steps: {
        create: workflowSteps.map((step) => ({
          key: step.key,
          label: step.label,
          status: step.key === "media_analysis" ? "done" : "pending",
          input: { instruction, targetTheme, mediaId },
          output: (step.key === "media_analysis" ? first.output : {}) as never,
        })),
      },
    },
    include: includeWorkflow(),
  });

  return NextResponse.json(workflow, { status: 201 });
}

// PATCH: 段階実行 / 記事選択 / 承認 / 修正再実行
export async function PATCH(req: NextRequest) {
  const guard = await guardEntitlement();
  if (guard.res) return guard.res;
  const email = guard.user!.email;

  const body = await req.json();
  const workflowId = String(body.workflowId ?? "").trim();
  const action = String(body.action ?? "run_next").trim();
  if (!workflowId) return NextResponse.json({ error: "workflowId is required" }, { status: 400 });

  const workflow = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  if (!workflow) return NextResponse.json({ error: "workflow not found" }, { status: 404 });

  // WordPress 下書き保存 / 公開（手動トリガー。全自動フローでは run_next が自動保存する）
  if (action === "wp_draft" || action === "wp_publish") {
    const media = workflow.media;
    if (!media) {
      return NextResponse.json({ error: "フリー執筆の記事はWordPress保存の対象外です（Googleドキュメントに保存されています）" }, { status: 400 });
    }
    if (!media.wpUrl || !media.wpSecret) {
      return NextResponse.json({ error: "このメディアはWordPress未接続です" }, { status: 400 });
    }
    const swell = workflow.steps.find((s) => s.key === "swell_format");
    const swellOut = (swell?.output ?? {}) as { html?: string; title?: string };
    const baseHtml = swellOut.html ?? workflow.finalArticle ?? "";
    const title = workflow.finalArticleTitle ?? swellOut.title ?? workflow.selectedArticle ?? "記事";
    if (!baseHtml) return NextResponse.json({ error: "保存する本文がありません" }, { status: 400 });

    try {
      let finalHtml = workflow.finalHtml;
      let wpPostId = workflow.wpPostId ?? undefined;
      let imagesGenerated = workflow.imagesGenerated;

      // 初回：下書き作成→画像生成→アップロード→挿入して最終HTMLを作る
      if (!finalHtml) {
        const draft = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: baseHtml, status: "draft", postId: wpPostId });
        wpPostId = draft.postId;
        const built = await buildHtmlWithImages(workflow, media.wpUrl, media.wpSecret, baseHtml, wpPostId);
        finalHtml = built.html;
        imagesGenerated = built.count > 0;
      }

      const status = action === "wp_publish" ? "publish" : "draft";
      const result = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: finalHtml, status, postId: wpPostId });

      const updated = await prisma.contentWorkflow.update({
        where: { id: workflowId },
        data: {
          wpPostId: result.postId,
          wpEditLink: result.editLink,
          wpViewLink: result.viewLink,
          finalHtml,
          imagesGenerated,
          wpPublished: action === "wp_publish" ? true : workflow.wpPublished,
          ...(action === "wp_publish" ? { status: "completed", approved2: true } : {}),
        },
        include: includeWorkflow(),
      });
      return NextResponse.json(updated);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "WordPress保存に失敗しました" }, { status: 502 });
    }
  }

  // 修正再実行：指定ステップを revisionNote 付きで再生成
  if (action === "revise") {
    const reviseKey = String(body.stepKey ?? "").trim();
    const revisionNote = body.revisionNote ? String(body.revisionNote).trim() : null;
    if (!reviseKey) return NextResponse.json({ error: "stepKey is required" }, { status: 400 });
    const stepsForContext = workflow.steps.map((step) => (step.key === reviseKey ? { ...step, revisionNote } : step)) as WorkflowStep[];
    const { output, usage, aiError } = await runStepWithAI(reviseKey as WorkflowStepKey, {
      media: workflow.media ?? virtualMedia(workflow), instruction: workflow.instruction, targetTheme: workflow.targetTheme, targetWordCount: workflow.targetWordCount, steps: stepsForContext,
    });
    await reportAiCompanyUsage(email, usage);
    if (aiError) return NextResponse.json({ error: aiErrorMessage(aiError), aiFailed: true }, { status: 502 });
    await prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: reviseKey } },
      data: { status: "done", revisionNote, output: output as never },
    });
    const isDraft = reviseKey === "draft_article";
    let gdocData: { gdocId?: string; gdocUrl?: string } = {};
    if (isDraft) {
      const title = (output as { title?: string }).title ?? workflow.selectedArticle ?? "SEO記事";
      const body = (output as { body?: string }).body ?? "";
      const doc = await saveGoogleDoc(workflow.gdocId, title, body); // 同じDocへ上書き
      if (doc) gdocData = { gdocId: doc.docId, gdocUrl: doc.url };
    }
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: isDraft
        ? { finalArticleTitle: (output as { title?: string }).title ?? null, finalArticle: (output as { body?: string }).body ?? null, ...gdocData }
        : {},
      include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // run_next：未完のAIステップがあれば1つ実行
  const nextStep = firstPendingStep(workflow);
  if (nextStep) {
    const { output, usage, aiError } = await runStepWithAI(nextStep.key as WorkflowStepKey, {
      media: workflow.media ?? virtualMedia(workflow), instruction: workflow.instruction, targetTheme: workflow.targetTheme, targetWordCount: workflow.targetWordCount, steps: workflow.steps as WorkflowStep[],
    });
    await reportAiCompanyUsage(email, usage);
    // AI失敗（残高不足等）→ 雛形を保存せず、in_progressのまま原因を返す（チャージ後に続きから再開できる）
    if (aiError) return NextResponse.json({ error: aiErrorMessage(aiError), aiFailed: true }, { status: 502 });
    await prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: nextStep.key } },
      data: { status: "done", output: output as never },
    });

    const isDraft = nextStep.key === "draft_article";
    let gdocData: { gdocId?: string; gdocUrl?: string } = {};
    if (isDraft) {
      // 執筆完了時にGoogleドキュメントへ保存（既存があれば上書き）
      const title = (output as { title?: string }).title ?? workflow.selectedArticle ?? "SEO記事";
      const draftBody = (output as { body?: string }).body ?? "";
      const doc = await saveGoogleDoc(workflow.gdocId, title, draftBody);
      if (doc) gdocData = { gdocId: doc.docId, gdocUrl: doc.url };
    }

    const re = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: computeStatus(re!),
        currentStep: nextStep.key,
        ...(isDraft ? { finalArticleTitle: (output as { title?: string }).title ?? null, finalArticle: (output as { body?: string }).body ?? null, ...gdocData } : {}),
      },
      include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // 全AIステップ完了 → WordPressへ自動下書き保存（画像生成込み）。フリー執筆(media=null)は対象外。
  const media = workflow.media;
  if (media && media.wpUrl && media.wpSecret && !workflow.wpPostId) {
    const swell = workflow.steps.find((s) => s.key === "swell_format");
    const swellOut = (swell?.output ?? {}) as { html?: string; title?: string };
    const baseHtml = swellOut.html ?? workflow.finalArticle ?? "";
    const title = workflow.finalArticleTitle ?? swellOut.title ?? workflow.selectedArticle ?? "記事";
    try {
      if (!baseHtml) throw new Error("保存する本文がありません");
      const draft = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: baseHtml, status: "draft" });
      const built = await buildHtmlWithImages(workflow, media.wpUrl, media.wpSecret, baseHtml, draft.postId);
      const result = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: built.html, status: "draft", postId: draft.postId });
      const updated = await prisma.contentWorkflow.update({
        where: { id: workflowId },
        data: {
          status: "completed",
          wpPostId: result.postId,
          wpEditLink: result.editLink,
          wpViewLink: result.viewLink,
          finalHtml: built.html,
          imagesGenerated: built.count > 0,
        },
        include: includeWorkflow(),
      });
      return NextResponse.json(updated);
    } catch {
      // WP保存に失敗しても記事は保持し完了扱い（手動で「WordPress下書き保存」から再試行可能）
      const updated = await prisma.contentWorkflow.update({
        where: { id: workflowId }, data: { status: "completed" }, include: includeWorkflow(),
      });
      return NextResponse.json(updated);
    }
  }

  // WP未接続 or 既に保存済み → 完了
  const done = await prisma.contentWorkflow.update({
    where: { id: workflowId }, data: { status: "completed" }, include: includeWorkflow(),
  });
  return NextResponse.json(done);
}

// DELETE
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.contentWorkflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
