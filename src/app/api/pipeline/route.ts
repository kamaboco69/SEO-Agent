import { NextRequest, NextResponse } from "next/server";
import type { WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps, type WorkflowStepKey } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { getAiCompanyEntitlement, getCurrentUser, reportAiCompanyUsage } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// GET: ワークフロー一覧 or 単体取得
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const mediaId = req.nextUrl.searchParams.get("mediaId");

  if (id) {
    const wf = await prisma.contentWorkflow.findUnique({ where: { id }, include: includeWorkflow() });
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(wf);
  }

  const workflows = await prisma.contentWorkflow.findMany({
    where: mediaId ? { mediaId } : undefined,
    orderBy: { updatedAt: "desc" },
    include: includeWorkflow(),
  });
  return NextResponse.json(workflows);
}

// POST: パイプライン開始（ワークフロー作成 + step1=メディア分析をAI実行）
export async function POST(req: NextRequest) {
  const guard = await guardEntitlement();
  if (guard.res) return guard.res;

  const body = await req.json();
  const mediaId = String(body.mediaId ?? "").trim();
  const instruction = String(body.instruction ?? "").trim() || "このメディアの検索流入を伸ばす記事を作る";
  const targetTheme = body.targetTheme ? String(body.targetTheme).trim() : null;

  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  // 実行前に今月のトークン上限をチェック（超過なら開始させない）
  const email = guard.user!.email;
  const pre = await reportAiCompanyUsage(email);
  if (pre.ok && !pre.allowed) {
    return NextResponse.json(
      { error: pre.reason ?? "今月のトークン上限に達しています", overLimit: true, usedTokens: pre.usedTokens, limit: pre.limit },
      { status: 402 }
    );
  }

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  const first = await runStepWithAI("media_analysis", {
    media,
    instruction,
    targetTheme,
    steps: [],
  });
  // 使用トークンをAICompanyの今月使用量に計上
  await reportAiCompanyUsage(email, first.usage);

  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId,
      instruction,
      targetTheme,
      automationMode: "auto",
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

// PATCH: 次ステップをAI実行して前進 / 特定ステップの修正再実行
export async function PATCH(req: NextRequest) {
  const guard = await guardEntitlement();
  if (guard.res) return guard.res;

  const body = await req.json();
  const workflowId = String(body.workflowId ?? "").trim();
  const action = String(body.action ?? "run_next").trim();
  const reviseKey = body.stepKey ? String(body.stepKey).trim() : null;
  const revisionNote = body.revisionNote ? String(body.revisionNote).trim() : null;

  if (!workflowId) return NextResponse.json({ error: "workflowId is required" }, { status: 400 });

  const workflow = await prisma.contentWorkflow.findUnique({
    where: { id: workflowId },
    include: includeWorkflow(),
  });
  if (!workflow) return NextResponse.json({ error: "workflow not found" }, { status: 404 });

  // 修正再実行：指定ステップを revisionNote 付きで再生成
  if (action === "revise" && reviseKey) {
    const stepsForContext = workflow.steps.map((step) =>
      step.key === reviseKey ? { ...step, revisionNote } : step
    ) as WorkflowStep[];
    const { output, usage } = await runStepWithAI(reviseKey as WorkflowStepKey, {
      media: workflow.media,
      instruction: workflow.instruction,
      targetTheme: workflow.targetTheme,
      steps: stepsForContext,
    });
    if (guard.user) await reportAiCompanyUsage(guard.user.email, usage);
    await prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: reviseKey } },
      data: { status: "done", revisionNote, output: output as never },
    });
    const isDraft = reviseKey === "draft_article";
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: isDraft
        ? {
            finalArticleTitle: (output as { title?: string }).title ?? null,
            finalArticle: (output as { body?: string }).body ?? null,
          }
        : {},
      include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // run_next：未生成の最初のステップをAI実行
  const ordered = workflowSteps.map((s) => workflow.steps.find((step) => step.key === s.key)!).filter(Boolean);
  const nextStep = ordered.find((step) => !hasOutput(step));

  if (!nextStep) {
    const draft = workflow.steps.find((step) => step.key === "draft_article");
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: "completed",
        currentStep: "draft_article",
        finalArticleTitle: draft ? (draft.output as { title?: string }).title ?? null : null,
        finalArticle: draft ? (draft.output as { body?: string }).body ?? null : null,
      },
      include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  const { output, usage } = await runStepWithAI(nextStep.key as WorkflowStepKey, {
    media: workflow.media,
    instruction: workflow.instruction,
    targetTheme: workflow.targetTheme,
    steps: workflow.steps as WorkflowStep[],
  });
  if (guard.user) await reportAiCompanyUsage(guard.user.email, usage);

  await prisma.workflowStep.update({
    where: { workflowId_key: { workflowId, key: nextStep.key } },
    data: { status: "done", output: output as never },
  });

  const remaining = ordered.filter((step) => step.key !== nextStep.key && !hasOutput(step));
  const isLast = remaining.length === 0;
  const isDraft = nextStep.key === "draft_article";

  const updated = await prisma.contentWorkflow.update({
    where: { id: workflowId },
    data: {
      status: isLast ? "completed" : "in_progress",
      currentStep: isLast ? nextStep.key : remaining[0].key,
      ...(isDraft
        ? {
            finalArticleTitle: (output as { title?: string }).title ?? null,
            finalArticle: (output as { body?: string }).body ?? null,
          }
        : {}),
    },
    include: includeWorkflow(),
  });

  return NextResponse.json(updated);
}

// DELETE: ワークフロー削除
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.contentWorkflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
