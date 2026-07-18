import { prisma } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/cache";

// WordPress側の「実際の公開状態」をDBへ同期する。
// WP管理画面から直接公開された記事は wpPublished=false のまま残り、
// LIFF/記事履歴で「承認待ち」と表示され続けるため、一覧表示のタイミングで実状態を確認する。
// 公開済み記事はWordPressの公開REST（/wp-json/wp/v2/posts/{id}）が認証なしで200を返すことを利用
//（下書きは401/404）。未公開の確認結果は10分キャッシュしてWPへの問い合わせを抑える。

type SyncTarget = {
  id: string;
  wpPostId: number | null;
  wpPublished: boolean;
  media: { wpUrl: string | null } | null;
};

// 戻り値: 今回「公開済み」に更新できた workflowId の集合
export async function syncWpPublished(wfs: SyncTarget[]): Promise<Set<string>> {
  const updated = new Set<string>();
  const targets = wfs.filter((w) => w.wpPostId && !w.wpPublished && w.media?.wpUrl).slice(0, 12);
  await Promise.allSettled(
    targets.map(async (w) => {
      const cacheKey = `wppub:${w.id}`;
      if (await cacheGet(cacheKey)) return; // 直近で「未公開」を確認済み
      try {
        const base = w.media!.wpUrl!.replace(/\/+$/, "");
        const res = await fetch(`${base}/wp-json/wp/v2/posts/${w.wpPostId}`, {
          signal: AbortSignal.timeout(5000),
          headers: { "User-Agent": "SEO Agent status sync" },
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { status?: string; link?: string } | null;
          if (!data || data.status === "publish" || data.link) {
            await prisma.contentWorkflow.update({
              where: { id: w.id },
              data: { wpPublished: true, status: "completed", ...(data?.link ? { wpViewLink: data.link } : {}) },
            });
            updated.add(w.id);
            return;
          }
        }
        await cacheSet(cacheKey, { draft: true }, 600);
      } catch {
        /* WP未応答などは次回に再確認 */
      }
    })
  );
  return updated;
}
