import type { ContentWorkflow, Media, WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps, type WorkflowStepKey } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { reportAiCompanyUsage, saveGoogleDoc } from "@/lib/auth";
import { wpUpsertPost, wpUploadImage } from "@/lib/wordpress";
import { generateImage, imageGenEnabled } from "@/lib/openaiImage";

// パイプライン実行の共通ロジック。
// /api/pipeline（ブラウザ駆動）と /api/schedule/tick（cron自動実行）の両方から使う。

export type WorkflowFull = ContentWorkflow & { media: Media | null; steps: WorkflowStep[] };

export function includeWorkflow() {
  return {
    media: { include: { project: { select: { id: true, name: true, domain: true } } } },
    steps: { orderBy: { createdAt: "asc" as const } },
  };
}

export function hasOutput(step: { output: unknown }) {
  return Boolean(step.output && typeof step.output === "object" && Object.keys(step.output as object).length > 0);
}

// AI失敗を利用者向けの分かりやすいメッセージに変換（テンプレ雛形を成果物として出さないため停止する）
export function aiErrorMessage(raw: string): string {
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
export async function buildHtmlWithImages(
  workflow: WorkflowFull,
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
export function virtualMedia(wf: { clientName: string | null; clientSite: string | null }) {
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
export function firstPendingStep(wf: WorkflowFull) {
  return workflowSteps
    .map((s) => wf.steps.find((st) => st.key === s.key))
    .find((st) => st && !hasOutput(st));
}

// 全自動：AIステップが残る、またはWP下書き保存が未実施なら in_progress。それ以外は completed。
export function computeStatus(wf: WorkflowFull & { media?: { wpUrl?: string | null; wpSecret?: string | null } | null }): "in_progress" | "completed" {
  if (firstPendingStep(wf)) return "in_progress";
  const wpConnected = Boolean(wf.media?.wpUrl && wf.media?.wpSecret);
  if (wpConnected && !wf.wpPostId) return "in_progress"; // WP自動保存が残っている
  return "completed";
}

// ワークフローを1手進める：未完のAIステップがあれば1つ実行、
// 全AIステップ完了ならWordPress自動下書き保存（画像生成込み）→完了。
// email があればAICompanyへトークン消費を計上する。
export async function advanceWorkflow(
  workflow: WorkflowFull,
  email: string | null
): Promise<{ workflow: WorkflowFull; aiError?: string; finished: boolean }> {
  const workflowId = workflow.id;

  const nextStep = firstPendingStep(workflow);
  if (nextStep) {
    const { output, usage, aiError } = await runStepWithAI(nextStep.key as WorkflowStepKey, {
      media: workflow.media ?? virtualMedia(workflow),
      instruction: workflow.instruction,
      targetTheme: workflow.targetTheme,
      targetWordCount: workflow.targetWordCount,
      steps: workflow.steps as WorkflowStep[],
    });
    if (email) await reportAiCompanyUsage(email, usage);
    // AI失敗（残高不足等）→ 雛形を保存せず、in_progressのまま原因を返す（チャージ後に続きから再開できる）
    if (aiError) return { workflow, aiError, finished: false };

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
    return { workflow: updated, finished: updated.status === "completed" };
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
      return { workflow: updated, finished: true };
    } catch {
      // WP保存に失敗しても記事は保持し完了扱い（手動で「WordPress下書き保存」から再試行可能）
      const updated = await prisma.contentWorkflow.update({
        where: { id: workflowId }, data: { status: "completed" }, include: includeWorkflow(),
      });
      return { workflow: updated, finished: true };
    }
  }

  // WP未接続 or 既に保存済み → 完了
  const done = await prisma.contentWorkflow.update({
    where: { id: workflowId }, data: { status: "completed" }, include: includeWorkflow(),
  });
  return { workflow: done, finished: true };
}
