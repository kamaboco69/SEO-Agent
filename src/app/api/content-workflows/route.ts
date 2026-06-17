import { NextRequest, NextResponse } from "next/server";
import type { WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateStepOutput, stepLabel, workflowSteps, type WorkflowStepKey } from "@/lib/contentWorkflow";

export const dynamic = "force-dynamic";

function includeWorkflow() {
  return {
    media: {
      include: {
        project: { select: { id: true, name: true, domain: true } },
      },
    },
    steps: {
      orderBy: { createdAt: "asc" as const },
    },
  };
}

export async function GET(req: NextRequest) {
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  const workflows = await prisma.contentWorkflow.findMany({
    where: mediaId ? { mediaId } : undefined,
    orderBy: { updatedAt: "desc" },
    include: includeWorkflow(),
  });

  return NextResponse.json(workflows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const mediaId = String(body.mediaId ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();
  const targetTheme = body.targetTheme ? String(body.targetTheme).trim() : null;
  const automationMode = body.automationMode ? String(body.automationMode) : "approval_required";

  if (!mediaId) return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: "instruction is required" }, { status: 400 });

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return NextResponse.json({ error: "media not found" }, { status: 404 });

  const firstOutput = generateStepOutput("media_analysis", {
    media,
    instruction,
    targetTheme,
    steps: [],
  });

  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId,
      instruction,
      targetTheme,
      automationMode,
      status: "in_review",
      currentStep: "media_analysis",
      steps: {
        create: workflowSteps.map((step) => ({
          key: step.key,
          label: step.label,
          status: step.key === "media_analysis" ? "in_review" : "pending",
          input: {
            instruction,
            targetTheme,
            mediaId,
          },
          output: step.key === "media_analysis" ? firstOutput : {},
        })),
      },
    },
    include: includeWorkflow(),
  });

  return NextResponse.json(workflow, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const workflowId = String(body.workflowId ?? "").trim();
  const stepKey = String(body.stepKey ?? "").trim();
  const action = String(body.action ?? "").trim();
  const revisionNote = body.revisionNote ? String(body.revisionNote).trim() : null;

  if (!workflowId) return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  if (!stepKey) return NextResponse.json({ error: "stepKey is required" }, { status: 400 });
  if (!["approve", "reject", "revise"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const workflow = await prisma.contentWorkflow.findUnique({
    where: { id: workflowId },
    include: includeWorkflow(),
  });
  if (!workflow) return NextResponse.json({ error: "workflow not found" }, { status: 404 });

  const currentStep = workflow.steps.find((step) => step.key === stepKey);
  if (!currentStep) return NextResponse.json({ error: "step not found" }, { status: 404 });

  if (action === "reject") {
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: "revision_requested",
        currentStep: stepKey,
        steps: {
          update: {
            where: { workflowId_key: { workflowId, key: stepKey } },
            data: {
              status: "revision_requested",
              revisionNote,
            },
          },
        },
      },
      include: includeWorkflow(),
    });

    return NextResponse.json(updated);
  }

  if (action === "revise") {
    const stepsForContext = workflow.steps.map((step) =>
      step.key === stepKey ? { ...step, revisionNote } : step
    ) as WorkflowStep[];
    const output = generateStepOutput(stepKey as WorkflowStepKey, {
      media: workflow.media,
      instruction: workflow.instruction,
      targetTheme: workflow.targetTheme,
      steps: stepsForContext,
    });
    const updated = await prisma.contentWorkflow.update({
      where: { id: workflowId },
      data: {
        status: "in_review",
        currentStep: stepKey,
        steps: {
          update: {
            where: { workflowId_key: { workflowId, key: stepKey } },
            data: {
              status: "in_review",
              revisionNote,
              output,
            },
          },
        },
      },
      include: includeWorkflow(),
    });

    return NextResponse.json(updated);
  }

  const index = workflowSteps.findIndex((step) => step.key === stepKey);
  const next = workflowSteps[index + 1];
  const isLast = !next;

  const stepUpdates = [
    prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: stepKey } },
      data: {
        status: "approved",
        approvedAt: new Date(),
      },
    }),
  ];

  if (!isLast) {
    const output = generateStepOutput(next.key, {
      media: workflow.media,
      instruction: workflow.instruction,
      targetTheme: workflow.targetTheme,
      steps: workflow.steps.map((step) =>
        step.key === stepKey ? { ...step, status: "approved" } : step
      ) as WorkflowStep[],
    });
    stepUpdates.push(
      prisma.workflowStep.update({
        where: { workflowId_key: { workflowId, key: next.key } },
        data: {
          status: "in_review",
          input: { previousStep: stepKey, label: stepLabel(next.key) },
          output,
        },
      })
    );
  }

  await prisma.$transaction(stepUpdates);

  const finalStep = workflow.steps.find((step) => step.key === "draft_article");
  const workflowData = isLast
    ? {
        status: "completed",
        currentStep: stepKey,
        finalArticleTitle: (currentStep.output as { title?: string }).title ?? null,
        finalArticle: (currentStep.output as { body?: string }).body ?? null,
      }
    : {
        status: "in_review",
        currentStep: next.key,
        finalArticleTitle: finalStep ? (finalStep.output as { title?: string }).title ?? null : null,
      };

  const updated = await prisma.contentWorkflow.update({
    where: { id: workflowId },
    data: workflowData,
    include: includeWorkflow(),
  });

  return NextResponse.json(updated);
}
