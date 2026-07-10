import { NextRequest, NextResponse } from "next/server";
import type { Media } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { getAiCompanyEntitlement, reportAiCompanyUsage } from "@/lib/auth";
import { advanceWorkflow, includeWorkflow, type WorkflowFull } from "@/lib/pipelineRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 自動スケジュール実行（Vercel Cron が毎日叩く）。
// 1) スケジュール有効なメディアごとに「今月の残り本数」と「前回からの間隔」を見て、期日が来ていれば記事作成を開始
// 2) 進行中のスケジュール記事を1ステップずつ進める（時間切れなら自分自身を再度呼んで続きから）
//
// 認証: Vercel Cron は Authorization: Bearer ${CRON_SECRET} を自動付与。自己チェーン/手動は x-cron-secret。

const TIME_BUDGET_MS = 230_000; // maxDuration 300s に対し、チェーン発火の余裕を残す
const MAX_CHAIN = 40;
const JST = 9 * 3600 * 1000;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function baseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req.nextUrl.origin;
}

// JST基準の「今月」情報
function jstMonth(now = new Date()) {
  const j = new Date(now.getTime() + JST);
  const monthStart = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST);
  const daysInMonth = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 0)).getUTCDate();
  return { monthStart, daysInMonth };
}

// 実行主体（スケジュールを設定したユーザー）の契約と使用量を確認
async function ownerAllowed(email: string | null): Promise<{ ok: boolean; email: string | null; reason?: string }> {
  if (!email) return { ok: false, email: null, reason: "スケジュール設定者が不明" };
  const user = await prisma.authUser.findUnique({ where: { email } });
  if (!user) return { ok: false, email, reason: "設定者のアカウントが見つからない" };
  const ent = await getAiCompanyEntitlement(user.id, user.email);
  if (!ent.entitled) return { ok: false, email, reason: "有料プラン未契約" };
  const usage = await reportAiCompanyUsage(email);
  if (usage.ok && !usage.allowed) return { ok: false, email, reason: usage.reason ?? "今月のトークン上限に到達" };
  return { ok: true, email };
}

// 期日が来ていれば新しいスケジュール記事のワークフローを作成（media_analysis まで実行）
async function createIfDue(media: Media, force: boolean, log: string[]): Promise<WorkflowFull | null> {
  const perMonth = Math.max(1, media.schedulePerMonth || 1);
  const { monthStart, daysInMonth } = jstMonth();

  const countThisMonth = await prisma.contentWorkflow.count({
    where: { mediaId: media.id, origin: "schedule", createdAt: { gte: monthStart } },
  });
  if (!force && countThisMonth >= perMonth) {
    log.push(`${media.name}: 今月分 ${countThisMonth}/${perMonth} 本作成済み → スキップ`);
    return null;
  }

  // 均等配分（例: 月2本→約15日間隔）。日次cronのズレで後ろへ流れないよう1割の猶予を持たせる
  const intervalMs = Math.max(1, Math.floor(daysInMonth / perMonth)) * 86400_000;
  if (!force && media.scheduleLastRunAt && Date.now() - media.scheduleLastRunAt.getTime() < intervalMs * 0.9) {
    log.push(`${media.name}: 前回から間隔未達 → スキップ`);
    return null;
  }

  // 前の自動記事がまだ進行中なら二重に始めない
  const inProgress = await prisma.contentWorkflow.count({
    where: { mediaId: media.id, origin: "schedule", status: "in_progress" },
  });
  if (inProgress > 0) {
    log.push(`${media.name}: 進行中のスケジュール記事あり → 新規作成は見送り`);
    return null;
  }

  const owner = await ownerAllowed(media.scheduleOwnerEmail);
  if (!owner.ok) {
    log.push(`${media.name}: ${owner.reason} → スキップ`);
    return null;
  }

  // 直近の作成テーマを渡して重複記事を防ぐ（WP下書きは既存記事一覧に出ないため）
  const recent = await prisma.contentWorkflow.findMany({
    where: { mediaId: media.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { finalArticleTitle: true, selectedArticle: true },
  });
  const recentTitles = recent
    .map((w) => w.finalArticleTitle || w.selectedArticle)
    .filter((t): t is string => Boolean(t));

  const instruction =
    (media.scheduleInstruction?.trim() || "このメディアの検索流入を伸ばす記事を作る（自動スケジュール実行）") +
    (recentTitles.length ? `\n【重複禁止】直近で作成済みのテーマ: ${recentTitles.join(" / ")}` : "");
  const targetWordCount = media.scheduleWordCount ?? null;

  const first = await runStepWithAI("media_analysis", { media, instruction, targetTheme: null, targetWordCount, steps: [] });
  if (owner.email) await reportAiCompanyUsage(owner.email, first.usage);
  if (first.aiError) {
    log.push(`${media.name}: メディア分析でAIエラー（${first.aiError.slice(0, 80)}）→ 次回リトライ`);
    return null;
  }

  const recommended = (first.output as { recommendedArticle?: string }).recommendedArticle ?? null;
  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId: media.id,
      origin: "schedule",
      instruction,
      targetTheme: recommended,
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
          input: { instruction, mediaId: media.id, origin: "schedule" },
          output: (step.key === "media_analysis" ? first.output : {}) as never,
        })),
      },
    },
    include: includeWorkflow(),
  });
  await prisma.media.update({ where: { id: media.id }, data: { scheduleLastRunAt: new Date() } });
  log.push(`${media.name}: 記事作成を開始「${recommended ?? "(テーマ自動選定)"}」`);
  return workflow;
}

// 続きがあるとき、自分自身を叩いて新しい実行時間枠で継続する（応答は待たずに切る）
async function chainNext(req: NextRequest, depth: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(`${baseUrl(req)}/api/schedule/tick?chain=${depth + 1}`, {
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      signal: ctrl.signal,
    });
  } catch {
    // 3秒で切るのは想定どおり（リクエストが届いた時点で継続実行される）
  } finally {
    clearTimeout(t);
  }
}

async function runTick(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const chain = Number(req.nextUrl.searchParams.get("chain") ?? 0);
  const forceMediaId = req.nextUrl.searchParams.get("force"); // 検証・手動実行用：期日判定を無視して即作成
  const log: string[] = [];
  let advancedSteps = 0;
  const finished: string[] = [];
  let hadAiError = false;

  // 1) 期日が来たメディアの記事作成を開始（チェーン継続時はスキップして進行だけ担当）
  const createdIds: string[] = [];
  if (chain === 0) {
    const targets = await prisma.media.findMany({
      where: forceMediaId ? { id: forceMediaId, scheduleEnabled: true } : { scheduleEnabled: true },
    });
    for (const media of targets) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const wf = await createIfDue(media, Boolean(forceMediaId), log);
      if (wf) createdIds.push(wf.id);
    }
  }

  // 2) 進行中のスケジュール記事を進める（古い順）
  const pending = await prisma.contentWorkflow.findMany({
    where: { origin: "schedule", status: "in_progress" },
    orderBy: { updatedAt: "asc" },
    include: includeWorkflow(),
  });

  let needMore = false;
  for (let wf of pending as WorkflowFull[]) {
    const email = wf.media?.scheduleOwnerEmail ?? null;
    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        needMore = true;
        break;
      }
      const adv = await advanceWorkflow(wf, email);
      if (adv.aiError) {
        // 残高不足など。ここで止めて次回cronでリトライ（無限チェーンはしない）
        log.push(`「${wf.selectedArticle ?? wf.id}」: AIエラーで一時停止（${adv.aiError.slice(0, 80)}）`);
        hadAiError = true;
        break;
      }
      advancedSteps += 1;
      wf = adv.workflow;
      if (adv.finished) {
        finished.push(wf.finalArticleTitle ?? wf.selectedArticle ?? wf.id);
        log.push(`「${wf.finalArticleTitle ?? wf.selectedArticle ?? wf.id}」: 完成（WordPress下書き保存まで完了）`);
        break;
      }
    }
    if (needMore) break;
  }

  // 3) 時間切れで残作業があれば自己チェーンで継続（AIエラー時は翌cronまで待つ）
  let chained = false;
  if (needMore && !hadAiError && chain < MAX_CHAIN) {
    await chainNext(req, chain);
    chained = true;
  }

  return NextResponse.json({
    ok: true,
    chain,
    created: createdIds.length,
    advancedSteps,
    finished,
    chained,
    log,
    elapsedSec: Math.round((Date.now() - started) / 1000),
  });
}

export async function GET(req: NextRequest) {
  return runTick(req);
}

export async function POST(req: NextRequest) {
  return runTick(req);
}
