import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifySsoToken } from "@/lib/aicompany-sso";
import { workflowSteps, stepLabel } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { readGoogleDoc, reportAiCompanyUsage } from "@/lib/auth";
import { approveWithLatestDoc } from "@/lib/approveArticle";
import { wpUpsertPost } from "@/lib/wordpress";
import {
  aiErrorMessage,
  buildHtmlWithImages,
  hasOutput,
  includeWorkflow,
  type WorkflowFull,
} from "@/lib/pipelineRunner";

// AI Company サーバー間ブリッジ（/api/agent/*）の共通ロジック。
// 認証はSSOと同じHMACトークン（AI_COMPANY_WEBHOOK_SECRET / {email, exp}）を
// Authorization: Bearer で受ける。email はトークン消費の計上（reportAiCompanyUsage）に使う。
// 呼び出し元のAI Company側で「マハル雇用＋有料プラン」のゲートを通過済みの前提。

export function agentEmail(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  return verifySsoToken(auth.slice(7).trim())?.email ?? null;
}

// LIFF/LINE表示用のワークフロー要約
export function workflowSnapshot(wf: WorkflowFull) {
  return {
    id: wf.id,
    status: wf.status,
    // 工程チェックリスト（LIFFの進捗フロー表示用）
    steps: workflowSteps.map((s) => {
      const st = wf.steps.find((x) => x.key === s.key);
      return { key: s.key, label: s.label, done: Boolean(st && hasOutput(st)) };
    }),
    wpPublished: wf.wpPublished,
    title: wf.finalArticleTitle ?? wf.selectedArticle ?? wf.targetTheme ?? "記事",
    mediaId: wf.mediaId,
    mediaName: wf.media?.name ?? null,
    currentStepLabel: wf.currentStep ? stepLabel(wf.currentStep) : null,
    stepsDone: wf.steps.filter(hasOutput).length,
    stepsTotal: workflowSteps.length,
    gdocUrl: wf.gdocUrl,
    wpEditLink: wf.wpEditLink,
    wpViewLink: wf.wpViewLink,
    updatedAt: wf.updatedAt,
  };
}

// 記事完成時にAI Companyへ通知し、LINEの承認カード（✅WordPressへ公開 等）を届けてもらう。
// 自動スケジュール実行・自動再開（tick）で完成した記事用（LIFF起動の執筆はAI Company側が自前で送る）。
// WordPress接続メディアの記事のみ（公開ボタンが意味を持つため）。二重送信はキャッシュで防止。
export async function notifyArticleReadyToLine(wf: WorkflowFull): Promise<void> {
  try {
    if (!wf.media?.wpUrl || wf.wpPublished) return;
    const email = wf.ownerEmail ?? wf.media?.scheduleOwnerEmail;
    const profile = process.env.AI_COMPANY_PROFILE_URL;
    const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
    if (!email || !profile || !secret) return;

    const { cacheGet, cacheSet } = await import("@/lib/cache");
    const key = `linecard:${wf.id}`;
    if (await cacheGet(key)) return; // 送信済み
    await cacheSet(key, { t: Date.now() }, 30 * 24 * 3600);

    await fetch(profile.replace(/\/profile.*$/, "/notify"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-company-secret": secret },
      body: JSON.stringify({ email, snap: workflowSnapshot(wf) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    /* 通知失敗は本処理に影響させない（記事自体は完成済み） */
  }
}

// メディア指定の執筆ワークフロー開始（/api/pipeline POST のブリッジ版・メディア分析まで実行）
export async function startMediaWorkflow(
  email: string,
  mediaId: string,
  opts: { instruction?: string | null; targetTheme?: string | null; targetWordCount?: number | null }
): Promise<{ workflow?: WorkflowFull; error?: string; status?: number }> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return { error: "メディアが見つかりません", status: 404 };

  const pre = await reportAiCompanyUsage(email);
  if (pre.ok && !pre.allowed) {
    return { error: pre.reason ?? "今月のトークン上限に達しています", status: 402 };
  }

  const instruction = opts.instruction?.trim() || "このメディアの検索流入を伸ばす記事を作る";
  const targetTheme = opts.targetTheme?.trim() || null;
  const rawWc = Number(opts.targetWordCount);
  const targetWordCount = Number.isFinite(rawWc) && rawWc > 0 ? Math.min(20000, Math.round(rawWc)) : null;

  const first = await runStepWithAI("media_analysis", { media, instruction, targetTheme, targetWordCount, steps: [] });
  await reportAiCompanyUsage(email, first.usage);
  if (first.aiError) return { error: aiErrorMessage(first.aiError), status: 502 };

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
          input: { instruction, targetTheme, mediaId, origin: "line" },
          output: (step.key === "media_analysis" ? first.output : {}) as never,
        })),
      },
    },
    include: includeWorkflow(),
  });
  return { workflow };
}

// 公開（LINEの承認から呼ばれる）:
// Googleドキュメントが編集されていれば取り込み→装飾HTML・画像を作り直してから公開。
// 未編集で最終HTMLが既にあれば、画像を再生成せずそのまま公開する（コスト・時間の節約）。
export async function publishWorkflow(
  workflowId: string,
  email: string
): Promise<{
  ok?: boolean;
  already?: boolean;
  docChanged?: boolean;
  viewLink?: string | null;
  editLink?: string | null;
  title?: string;
  error?: string;
  status?: number;
}> {
  let wf = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  if (!wf) return { error: "記事が見つかりません", status: 404 };
  if (wf.wpPublished) {
    return { ok: true, already: true, viewLink: wf.wpViewLink, editLink: wf.wpEditLink, title: wf.finalArticleTitle ?? "記事" };
  }
  const media = wf.media;
  if (!media?.wpUrl || !media?.wpSecret) {
    return { error: "このメディアはWordPress未接続のため公開できません", status: 400 };
  }

  // Docが人の手で編集されているか（十分な長さがあり保存済み本文と異なる場合のみ「編集あり」とみなす）
  let docChanged = false;
  if (wf.gdocId) {
    const doc = await readGoogleDoc(wf.gdocId);
    const docText = doc?.text?.trim() ?? "";
    if (docText.length >= 100 && docText !== (wf.finalArticle ?? "").trim()) docChanged = true;
  }

  if (docChanged || !wf.finalHtml) {
    const r = await approveWithLatestDoc(workflowId, email);
    if (r.error) return { error: r.error, status: r.status };
    wf = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
    if (!wf) return { error: "記事が見つかりません", status: 404 };
  }

  const swellOut = (wf.steps.find((s) => s.key === "swell_format")?.output ?? {}) as { html?: string; title?: string };
  const baseHtml = swellOut.html ?? wf.finalArticle ?? "";
  const title = wf.finalArticleTitle ?? swellOut.title ?? wf.selectedArticle ?? "記事";
  if (!baseHtml && !wf.finalHtml) return { error: "公開する本文がありません", status: 400 };

  try {
    let finalHtml = wf.finalHtml;
    let wpPostId = wf.wpPostId ?? undefined;
    let imagesGenerated = wf.imagesGenerated;
    if (!finalHtml) {
      const draft = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: baseHtml, status: "draft", postId: wpPostId });
      wpPostId = draft.postId;
      const built = await buildHtmlWithImages(wf, media.wpUrl, media.wpSecret, baseHtml, wpPostId);
      finalHtml = built.html;
      imagesGenerated = built.count > 0;
    }
    const result = await wpUpsertPost(media.wpUrl, media.wpSecret, { title, content: finalHtml, status: "publish", postId: wpPostId });
    await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: {
        wpPostId: result.postId,
        wpEditLink: result.editLink,
        wpViewLink: result.viewLink,
        finalHtml,
        imagesGenerated,
        wpPublished: true,
        approved1: true,
        approved2: true,
        status: "completed",
      },
    });
    return { ok: true, docChanged, viewLink: result.viewLink, editLink: result.editLink, title };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "WordPress公開に失敗しました", status: 502 };
  }
}
