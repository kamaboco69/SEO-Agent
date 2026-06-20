// SEO Agent Connector（WordPress側のmu-plugin）と通信するクライアント。
// 認証はヘッダーやRESTを使わず、共有シークレット＋通常URL(/?seo_agent=...)で行う。
// （対象サイトがnginxでAuthorizationヘッダー削除・REST/ajax制限のため）

function normalizeBase(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  return u;
}

async function call(
  wpUrl: string,
  secret: string,
  op: "diag" | "upsert" | "upload",
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const base = normalizeBase(wpUrl);
  const body = new URLSearchParams({ secret, ...params });
  const res = await fetch(`${base}/?seo_agent=${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString(),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WordPress応答が不正です (HTTP ${res.status})`);
  }
  if (!res.ok || data.ok === false) {
    throw new Error(String(data.error ?? `WordPress接続エラー (HTTP ${res.status})`));
  }
  return data;
}

export async function wpDiag(wpUrl: string, secret: string) {
  return call(wpUrl, secret, "diag");
}

export async function wpUpsertPost(
  wpUrl: string,
  secret: string,
  opts: { title: string; content: string; status?: "draft" | "publish"; postId?: number; excerpt?: string }
) {
  const params: Record<string, string> = {
    title: opts.title,
    content: opts.content,
    status: opts.status ?? "draft",
  };
  if (opts.postId) params.post_id = String(opts.postId);
  if (opts.excerpt) params.excerpt = opts.excerpt;
  const data = await call(wpUrl, secret, "upsert", params);
  return {
    postId: Number(data.post_id),
    status: String(data.status ?? ""),
    editLink: String(data.edit_link ?? ""),
    viewLink: String(data.view_link ?? ""),
  };
}

export async function wpUploadImage(
  wpUrl: string,
  secret: string,
  opts: { filename: string; base64: string; postId?: number; setFeatured?: boolean }
) {
  const params: Record<string, string> = {
    filename: opts.filename,
    data_base64: opts.base64,
  };
  if (opts.postId) params.post_id = String(opts.postId);
  if (opts.setFeatured) params.set_featured = "1";
  const data = await call(wpUrl, secret, "upload", params);
  return {
    attachmentId: Number(data.attachment_id),
    url: String(data.url ?? ""),
  };
}
