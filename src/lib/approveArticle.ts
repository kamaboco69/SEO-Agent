import type { WorkflowStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runStepWithAI } from "@/lib/aiSteps";
import { readGoogleDoc, reportAiCompanyUsage } from "@/lib/auth";
import { aiErrorMessage, includeWorkflow } from "@/lib/pipelineRunner";

// 記事の「承認」フェーズ1:
// 1) 最新のGoogleドキュメントを取得（人がDoc上で修正していればそれを正とする）
// 2) 最新本文で WordPress 装飾HTML（swell_format）を再生成
// 3) finalHtml をリセット → 直後に既存の wp_draft フロー（画像生成込み）でWordPressへ反映される
export async function approveWithLatestDoc(
  workflowId: string,
  email: string | null
): Promise<{ ok?: boolean; error?: string; status?: number; docUpdated?: boolean; title?: string }> {
  const wf = await prisma.contentWorkflow.findUnique({ where: { id: workflowId }, include: includeWorkflow() });
  if (!wf) return { error: "記事が見つかりません", status: 404 };
  if (wf.status === "in_progress") return { error: "生成中の記事は承認できません（完了後にお試しください）", status: 400 };
  const media = wf.media;
  if (!media?.wpUrl || !media?.wpSecret) {
    return { error: "このメディアはWordPress未接続のため投稿できません（Googleドキュメントの記事をそのままご利用ください）", status: 400 };
  }

  const draftStep = wf.steps.find((s) => s.key === "draft_article");
  const draftOut = (draftStep?.output ?? {}) as { title?: string; body?: string };
  let body = (wf.finalArticle ?? draftOut.body ?? "").trim();
  const title = wf.finalArticleTitle ?? draftOut.title ?? wf.selectedArticle ?? "記事";
  let docUpdated = false;

  // 最新のGoogleドキュメントを確認（取得できないときは保存済み本文で続行）
  if (wf.gdocId) {
    const doc = await readGoogleDoc(wf.gdocId);
    const docText = doc?.text?.trim() ?? "";
    // 誤って空にしたDocで記事を消さないよう、最低限の長さがある場合のみ採用
    if (docText.length >= 100) {
      docUpdated = docText !== body;
      body = docText;
    }
  }
  if (!body) return { error: "本文がありません（記事の執筆が完了しているか確認してください）", status: 400 };

  // 本文を確定し、draft_article ステップにも反映（装飾の材料を最新化）
  await prisma.contentWorkflow.update({
    where: { id: workflowId },
    data: { finalArticle: body, finalArticleTitle: title },
  });
  if (draftStep) {
    await prisma.workflowStep.update({
      where: { workflowId_key: { workflowId, key: "draft_article" } },
      data: { output: { ...draftOut, title, body } as never },
    });
  }

  // 最新本文で WordPress 装飾HTMLを再生成
  const stepsCtx = wf.steps.map((s) =>
    s.key === "draft_article" ? { ...s, output: { ...draftOut, title, body } } : s
  ) as WorkflowStep[];
  const { output, usage, aiError } = await runStepWithAI("swell_format", {
    media,
    instruction: wf.instruction,
    targetTheme: wf.targetTheme,
    targetWordCount: wf.targetWordCount,
    steps: stepsCtx,
  });
  if (email) await reportAiCompanyUsage(email, usage);
  if (aiError) return { error: aiErrorMessage(aiError), status: 502 };

  await prisma.workflowStep.update({
    where: { workflowId_key: { workflowId, key: "swell_format" } },
    data: { status: "done", output: output as never },
  });

  // finalHtml をリセット → 続けて呼ばれる wp_draft（既存フロー）が画像生成込みで作り直す
  await prisma.contentWorkflow.update({
    where: { id: workflowId },
    data: { finalHtml: null, imagesGenerated: false, approved1: true },
  });

  return { ok: true, docUpdated, title };
}
