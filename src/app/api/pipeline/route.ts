import { NextRequest, NextResponse } from "next/server";
import type { ContentWorkflow, WorkflowStep } from "@prisma/client";
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

type WfWithSteps = ContentWorkflow & { steps: WorkflowStep[] };

// 段階実行のゲート判定。次に何をすべきか（ステップ実行 or 人間アクション or 完了）。
function gate(wf: WfWithSteps):
  | "running"
  | "awaiting_selection"
  | "awaiting_approval_1"
  | "awaiting_approval_2"
  | "completed" {
  const ordered = workflowSteps.map((s) => wf.steps.find((st) => st.key === s.key)).filter(Boolean) as WorkflowStep[];
  const next = ordered.find((st) => !hasOutput(st));
  if (!next) return wf.approved2 ? "completed" : "awaiting_approval_2";
  // 記事選択ゲート：おすすめ記事を人間が選ぶまでKW調査に進まない
  if (next.key === "keyword_research" && !wf.selectedArticle) return "awaiting_selection";
  // 承認ゲート1：執筆完了→人間承認までHTML整形に進まない
  if (next.key === "swell_format" && !wf.approved1) return "awaiting_approval_1";
  return "running";
}

// 保存用ステータス（"running" は内部的に in_progress として保存）
function storedStatus(g: ReturnType<typeof gate>): string {
  return g === "running" ? "in_progress" : g;
}

// GET: 一覧 or 単体
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

// POST: 開始（ワークフロー作成 + メディア分析を実行 → おすすめ記事の選択待ちへ）
export async function POST(req: NextRequest) {
  const guard = await guardEntitlement();
  if (guard.res) return guard.res;
  const email = guard.user!.email;

  const body = await req.json();
  const mediaId = String(body.mediaId ?? "").trim();
  const instruction = String(body.instruction ?? "").trim() || "このメディアの検索流入を伸ばす記事を作る";
  const targetTheme = body.targetTheme ? String(body.targetTheme).trim() : null;
  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });

  const pre = await reportAiCompanyUsage(email);
  if (pre.ok && !pre.allowed) {
    return NextResponse.json(
      { error: pre.reason ?? "今月のトークン上限に達しています", overLimit: true, usedTokens: pre.usedTokens, limit: pre.limit },
      { status: 402 }
    );
  }

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  const first = await runStepWithAI("media_analysis", { media, instruction, targetTheme, steps: [] });
  await reportAiCompanyUsage(email, first.usage);

  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId,
      instruction,
      targetTheme,
      automationMode: "staged",
      status: "awaiting_selection",
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

  let workflow = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  if (!workflow) return NextResponse.json({ error: "workflow not found" }, { status: 404 });

  // 記事選択：おすすめ記事を確定（以降のステップはこの記事に集中）
  if (action === "select_article") {
    const articleTitle = String(body.articleTitle ?? "").trim();
    if (!articleTitle) return NextResponse.json({ error: "articleTitle is required" }, { status: 400 });
    workflow = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: { selectedArticle: articleTitle, targetTheme: articleTitle },
      include: includeWorkflow(),
    });
    const g = gate(workflow);
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId }, data: { status: storedStatus(g) }, include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // 承認（ゲート1/2）
  if (action === "approve") {
    const g0 = Number(body.gate ?? 0);
    const data = g0 === 1 ? { approved1: true } : g0 === 2 ? { approved2: true } : {};
    workflow = await prisma.contentWorkflow.update({ where: { id: workflowId }, data, include: includeWorkflow() });
    const g = gate(workflow);
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId }, data: { status: storedStatus(g) }, include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // 修正再実行：指定ステップを revisionNote 付きで再生成
  if (action === "revise") {
    const reviseKey = String(body.stepKey ?? "").trim();
    const revisionNote = body.revisionNote ? String(body.revisionNote).trim() : null;
    if (!reviseKey) return NextResponse.json({ error: "stepKey is required" }, { status: 400 });
    const stepsForContext = workflow.steps.map((step) => (step.key === reviseKey ? { ...step, revisionNote } : step)) as WorkflowStep[];
    const { output, usage } = await runStepWithAI(reviseKey as WorkflowStepKey, {
      media: workflow.media, instruction: workflow.instruction, targetTheme: workflow.targetTheme, steps: stepsForContext,
    });
    await reportAiCompanyUsage(email, usage);
    await prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: reviseKey } },
      data: { status: "done", revisionNote, output: output as never },
    });
    const isDraft = reviseKey === "draft_article";
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: isDraft
        ? { finalArticleTitle: (output as { title?: string }).title ?? null, finalArticle: (output as { body?: string }).body ?? null }
        : {},
      include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  // run_next：ゲートを尊重して次の1ステップを実行
  const g = gate(workflow);
  if (g !== "running") {
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId }, data: { status: storedStatus(g) }, include: includeWorkflow(),
    });
    return NextResponse.json(updated);
  }

  const ordered = workflowSteps.map((s) => workflow!.steps.find((st) => st.key === s.key)).filter(Boolean) as WorkflowStep[];
  const nextStep = ordered.find((st) => !hasOutput(st))!;

  const { output, usage } = await runStepWithAI(nextStep.key as WorkflowStepKey, {
    media: workflow.media, instruction: workflow.instruction, targetTheme: workflow.targetTheme, steps: workflow.steps as WorkflowStep[],
  });
  await reportAiCompanyUsage(email, usage);
  await prisma.workflowStep.update({
    where: { workflowId_key: { workflowId, key: nextStep.key } },
    data: { status: "done", output: output as never },
  });

  // 再取得してゲート再判定
  workflow = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  const g2 = gate(workflow!);
  const isDraft = nextStep.key === "draft_article";
  const updated = await prisma.contentWorkflow.update({
    where: { id: workflowId },
    data: {
      status: storedStatus(g2),
      currentStep: nextStep.key,
      ...(isDraft ? { finalArticleTitle: (output as { title?: string }).title ?? null, finalArticle: (output as { body?: string }).body ?? null } : {}),
    },
    include: includeWorkflow(),
  });
  return NextResponse.json(updated);
}

// DELETE
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.contentWorkflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
