import { NextRequest, NextResponse } from "next/server";
import type { WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps, type WorkflowStepKey } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { getAiCompanyEntitlement, getCurrentUser, reportAiCompanyUsage, saveGoogleDoc } from "@/lib/auth";
import { wpUpsertPost } from "@/lib/wordpress";
import {
  advanceWorkflow, aiErrorMessage, buildHtmlWithImages, includeWorkflow, virtualMedia,
} from "@/lib/pipelineRunner";

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
        ownerEmail: email,
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
      ownerEmail: email,
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

  // 作業停止：サーバーに「停止中」を記録し、cronの自動再開の対象から外す
  //（再開は run_next がそのまま実行して状態を上書きするため、専用アクションは不要）
  if (action === "pause") {
    if (workflow.status !== "in_progress") return NextResponse.json(workflow);
    const paused = await prisma.contentWorkflow.update({
      where: { id: workflowId }, data: { status: "paused" }, include: includeWorkflow(),
    });
    return NextResponse.json(paused);
  }

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

  // run_next：未完のAIステップがあれば1つ実行 / 完了済みならWP自動保存→完了（共通ロジック）
  const adv = await advanceWorkflow(workflow, email);
  if (adv.aiError) return NextResponse.json({ error: aiErrorMessage(adv.aiError), aiFailed: true }, { status: 502 });
  return NextResponse.json(adv.workflow);
}

// DELETE
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.contentWorkflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
