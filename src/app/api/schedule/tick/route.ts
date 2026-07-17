import { NextRequest, NextResponse } from "next/server";
import type { Media, ScheduledArticle } from "@prisma/client";
import { prisma } from "@/lib/db";
import { workflowSteps } from "@/lib/contentWorkflow";
import { runStepWithAI } from "@/lib/aiSteps";
import { getAiCompanyEntitlement, reportAiCompanyUsage } from "@/lib/auth";
import { advanceWorkflow, firstPendingStep, includeWorkflow, type WorkflowFull } from "@/lib/pipelineRunner";
import { reconcilePlan, syncCalendarEvents, cancelPlannedEntries, markPlanDone } from "@/lib/schedulePlan";
import { cacheDelPrefix, cacheGet, cacheSet } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 自動スケジュール実行（Vercel Cron が毎日叩く）。
// 0) 予定表の整備：今月・来月の執筆予定（日付＋AIテーマ）を目標本数に合わせ、AI秘書のGoogleカレンダーへ登録
// 1) 予定日が来たエントリの執筆を開始
// 2) 進行中のスケジュール記事を1ステップずつ進める（時間切れなら自分自身を再度呼んで続きから）
//
// 認証: Vercel Cron は Authorization: Bearer ${CRON_SECRET} を自動付与。自己チェーン/手動は x-cron-secret。

// 1ステップは最長で4分前後かかりうる（執筆・装飾HTMLのストリーミング、画像生成込みWP保存）。
// maxDuration 300s を超えないよう「経過45秒以内のときだけ新しいステップを開始」し、
// それ以降は自己チェーンで新しい実行時間枠に引き継ぐ。
const SOFT_BUDGET_MS = 45_000;
const MAX_CHAIN = 40;
const JST = 9 * 3600 * 1000;

// 多重実行ロック：Cloud Schedulerの10分毎ピングと自己チェーンが同時に走っても、
// 同じワークフローを二重に進めない。TTLは1ステップの最長（約300秒）より長くし、
// 実行枠ごと強制終了された場合も自然に解放される。
const LOCK_KEY = "lock:schedule-tick";
const LOCK_TTL_SEC = 330;

// 同一ステップの最大試行回数。300秒枠に収まらないステップ（超長文など）を
// 永遠にリトライしてコストが燃え続けるのを防ぎ、超えたら「エラー」で自動実行を停止する。
const MAX_STEP_ATTEMPTS = 4;

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

// 予定日を迎えたエントリの執筆を開始（media_analysis まで実行してワークフロー作成）
async function startEntry(entry: ScheduledArticle & { media: Media }, log: string[]): Promise<boolean> {
  const media = entry.media;

  // 前の自動記事がまだ進行中なら二重に始めない（完了後の次tickで開始される）
  const inProgress = await prisma.contentWorkflow.count({
    where: { mediaId: media.id, origin: "schedule", status: "in_progress" },
  });
  if (inProgress > 0) {
    log.push(`${media.name}: 進行中のスケジュール記事あり →「${entry.theme}」は後続で実行`);
    return false;
  }

  const owner = await ownerAllowed(media.scheduleOwnerEmail);
  if (!owner.ok) {
    log.push(`${media.name}: ${owner.reason} →「${entry.theme}」は保留`);
    return false;
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
    .filter((t): t is string => Boolean(t) && t !== entry.theme);

  const instruction =
    (media.scheduleInstruction?.trim() || "このメディアの検索流入を伸ばす記事を作る（自動スケジュール実行）") +
    (recentTitles.length ? `\n【重複禁止】直近で作成済みのテーマ: ${recentTitles.join(" / ")}` : "");
  // 予定ごとの文字数指定を優先し、なければメディアのスケジュール設定に従う
  const targetWordCount = entry.wordCount ?? media.scheduleWordCount ?? null;

  const first = await runStepWithAI("media_analysis", { media, instruction, targetTheme: entry.theme, targetWordCount, steps: [] });
  if (owner.email) await reportAiCompanyUsage(owner.email, first.usage);
  if (first.aiError) {
    log.push(`${media.name}: メディア分析でAIエラー（${first.aiError.slice(0, 80)}）→ 次回リトライ`);
    return false;
  }

  const workflow = await prisma.contentWorkflow.create({
    data: {
      mediaId: media.id,
      origin: "schedule",
      ownerEmail: owner.email,
      instruction,
      targetTheme: entry.theme,
      targetWordCount,
      selectedArticle: entry.theme,
      automationMode: "staged",
      status: "in_progress",
      currentStep: "keyword_research",
      steps: {
        create: workflowSteps.map((step) => ({
          key: step.key,
          label: step.label,
          status: step.key === "media_analysis" ? "done" : "pending",
          input: { instruction, mediaId: media.id, origin: "schedule", planId: entry.id },
          output: (step.key === "media_analysis" ? first.output : {}) as never,
        })),
      },
    },
  });
  await prisma.scheduledArticle.update({
    where: { id: entry.id },
    data: { status: "generating", workflowId: workflow.id },
  });
  await prisma.media.update({ where: { id: media.id }, data: { scheduleLastRunAt: new Date() } });
  log.push(`${media.name}: 予定「${entry.theme}」の執筆を開始`);
  return true;
}

// 続きがあるとき、自分自身を叩いて新しい実行時間枠で継続する（応答は待たずに切る）
async function chainNext(req: NextRequest, depth: number, resumeHint?: string | null) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const resume = resumeHint ? `&resume=${encodeURIComponent(resumeHint)}` : "";
    await fetch(`${baseUrl(req)}/api/schedule/tick?chain=${depth + 1}${resume}`, {
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

  // 実行中の別tick（長いステップ処理中など）があればスキップ（次のピングで再試行される）
  const lock = await cacheGet<{ t: number }>(LOCK_KEY);
  if (lock) return NextResponse.json({ ok: true, skipped: "already_running", lockedAt: new Date(lock.value.t).toISOString() });
  await cacheSet(LOCK_KEY, { t: Date.now() }, LOCK_TTL_SEC);

  let result: { payload: Record<string, unknown>; needChain: boolean; chain: number; resumeHint: string | null };
  try {
    result = await runTickBody(req);
  } finally {
    // チェーン先の新しい実行がロックに阻まれないよう、必ず解放してから発火する
    await cacheDelPrefix(LOCK_KEY);
  }
  let chained = false;
  if (result.needChain) {
    await chainNext(req, result.chain, result.resumeHint);
    chained = true;
  }
  return NextResponse.json({ ...result.payload, chained });
}

async function runTickBody(req: NextRequest) {
  const started = Date.now();
  const chain = Number(req.nextUrl.searchParams.get("chain") ?? 0);
  const forceMediaId = req.nextUrl.searchParams.get("force"); // 検証・手動実行用：予定日を無視して直近の予定を即実行
  const log: string[] = [];
  let advancedSteps = 0;
  const finished: string[] = [];
  let hadAiError = false;
  let needMore = false;
  const overBudget = () => Date.now() - started > SOFT_BUDGET_MS;

  // 0) 予定表の整備（今月・来月ぶんを目標本数に合わせる）＋ AI秘書カレンダー同期
  const targets = await prisma.media.findMany({ where: { scheduleEnabled: true } });
  for (const media of targets) {
    if (overBudget()) { needMore = true; break; }
    await reconcilePlan(media, log);
    await syncCalendarEvents(media, log);
  }
  // 無効化されたのに残っている自動予定を掃除（UI以外で無効化された場合の保険）
  const orphaned = await prisma.scheduledArticle.findMany({
    where: { status: "planned", source: "auto", media: { scheduleEnabled: false } },
    include: { media: true },
  });
  for (const mediaId of new Set(orphaned.map((o) => o.mediaId))) {
    const m = orphaned.find((o) => o.mediaId === mediaId)!.media;
    await cancelPlannedEntries(m, log);
  }
  // スケジュールOFFのメディアに残る手動予定のカレンダー未同期を再試行
  const unsynced = await prisma.scheduledArticle.findMany({
    where: { status: "planned", source: "manual", calendarEventId: null, media: { scheduleEnabled: false } },
    include: { media: true },
  });
  for (const mediaId of new Set(unsynced.map((o) => o.mediaId))) {
    const m = unsynced.find((o) => o.mediaId === mediaId)!.media;
    await syncCalendarEvents(m, log);
  }

  // 1) 予定日が来たエントリの執筆を開始（手動指定の予定はスケジュールOFFでも実行する）
  const now = new Date();
  const due = await prisma.scheduledArticle.findMany({
    where: forceMediaId
      ? { mediaId: forceMediaId, status: "planned" }
      : {
          status: "planned",
          plannedDate: { lte: now },
          OR: [{ source: "manual" }, { media: { scheduleEnabled: true } }],
        },
    include: { media: true },
    orderBy: { plannedDate: "asc" },
  });
  for (const entry of due) {
    if (overBudget()) { needMore = true; break; }
    await startEntry(entry, log);
    if (forceMediaId) break; // 手動実行は1件だけ
  }

  // 2) 進行中の記事を進める（古い順）。
  // スケジュール記事は常に対象。手動・フリー執筆の記事も「8分以上更新がない」＝
  // ブラウザが閉じられた/接続が切れた等で置き去りになったものは自動再開して完走させる
  //（実行中のブラウザは各ステップごとに更新するため誤って二重駆動しない。
  //   ユーザーが「作業停止」した記事は status=paused なので対象外）。
  // resume=<id> は自己チェーンからの継続ヒント（直前まで進めていた記事は更新が新しくても続行）。
  const resumeId = req.nextUrl.searchParams.get("resume");
  const staleBefore = new Date(Date.now() - 8 * 60_000);
  const pending = await prisma.contentWorkflow.findMany({
    where: {
      status: "in_progress",
      OR: [
        { origin: "schedule" },
        ...(resumeId ? [{ id: resumeId }] : []),
        { updatedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    include: includeWorkflow(),
  });

  let resumeHint: string | null = null;
  for (let wf of pending as WorkflowFull[]) {
    const email = wf.ownerEmail ?? wf.media?.scheduleOwnerEmail ?? null;
    for (;;) {
      // ステップ開始前に残り時間を確認（開始後の長時間ステップでmaxDurationを超えないため）
      if (overBudget()) {
        needMore = true;
        resumeHint = wf.id; // チェーン先で年齢フィルタに関係なくこの記事から続行する
        break;
      }

      // 同一ステップの試行回数ガード：実行枠（300秒）に収まらないステップを永遠にリトライしない。
      // 上限に達したら「エラー」にして自動実行を止める（記事履歴から手動の承認で再開できる）。
      const nextKey = firstPendingStep(wf)?.key ?? "wp_save";
      const attemptKey = `attempt:${wf.id}:${nextKey}`;
      const attempts = (await cacheGet<{ n: number }>(attemptKey))?.value.n ?? 0;
      if (attempts >= MAX_STEP_ATTEMPTS) {
        await prisma.contentWorkflow.update({ where: { id: wf.id }, data: { status: "error" } });
        await prisma.scheduledArticle.updateMany({ where: { workflowId: wf.id }, data: { status: "failed" } });
        log.push(`「${wf.finalArticleTitle ?? wf.selectedArticle ?? wf.id}」: ステップ「${nextKey}」が${attempts}回完了しなかったため自動実行を停止しました（文字数が大きすぎる可能性。記事履歴から確認できます）`);
        break;
      }
      await cacheSet(attemptKey, { n: attempts + 1 }, 24 * 3600);

      const adv = await advanceWorkflow(wf, email);
      if (adv.aiError) {
        // 残高不足など。ここで止めて次回cronでリトライ（無限チェーンはしない）
        log.push(`「${wf.selectedArticle ?? wf.id}」: AIエラーで一時停止（${adv.aiError.slice(0, 80)}）`);
        hadAiError = true;
        break;
      }
      await cacheDelPrefix(attemptKey); // ステップ完了→試行カウンタをクリア
      advancedSteps += 1;
      wf = adv.workflow;
      if (adv.finished) {
        await markPlanDone(wf.id);
        finished.push(wf.finalArticleTitle ?? wf.selectedArticle ?? wf.id);
        log.push(`「${wf.finalArticleTitle ?? wf.selectedArticle ?? wf.id}」: 完成`);
        break;
      }
    }
    if (needMore) break;
  }

  // 3) 時間切れで残作業があれば自己チェーンで継続（発火はロック解放後に呼び出し元が行う）
  return {
    needChain: needMore && !hadAiError && chain < MAX_CHAIN,
    chain,
    resumeHint,
    payload: {
      ok: true,
      chain,
      started: due.length,
      advancedSteps,
      finished,
      log,
      elapsedSec: Math.round((Date.now() - started) / 1000),
    },
  };
}

export async function GET(req: NextRequest) {
  return runTick(req);
}

export async function POST(req: NextRequest) {
  return runTick(req);
}
