import { prisma } from "@/lib/db";

// DBベースの汎用キャッシュ（Vercelサーバレスはインスタンス間でメモリを共有できないためDBに置く）。
// キャッシュの失敗は本処理に影響させない（読めなければ取得し直す・書けなければ無視）。

export async function cacheGet<T>(key: string): Promise<{ value: T; updatedAt: Date } | null> {
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt < new Date()) return null;
    return { value: row.payload as T, updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSec * 1000);
  try {
    await prisma.cacheEntry.upsert({
      where: { key },
      update: { payload: value as never, expiresAt },
      create: { key, payload: value as never, expiresAt },
    });
  } catch {
    /* キャッシュ保存失敗は無視 */
  }
}

// 前方一致でキャッシュを無効化（例: 計測設定の変更時に analytics:{mediaId} を全消し）
export async function cacheDelPrefix(prefix: string): Promise<void> {
  try {
    await prisma.cacheEntry.deleteMany({ where: { key: { startsWith: prefix } } });
  } catch {
    /* 無視 */
  }
}
