// 埋め込み（iframe）用のワンタイムSSOトークン検証。
// AI Company が SEO_INTEGRATION_SECRET と同値の AI_COMPANY_WEBHOOK_SECRET で署名し、SEO Agent が検証する。
// トークン形式: base64url(JSON{ email, exp }) + "." + base64url(HMAC-SHA256)

import crypto from "crypto";

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface SsoPayload {
  email: string;
  exp: number; // epoch ms
}

// 検証成功で payload を返す。失敗（署名不一致/期限切れ/形式不正）なら null。
export function verifySsoToken(token: string | null | undefined): SsoPayload | null {
  const secret = (process.env.AI_COMPANY_WEBHOOK_SECRET ?? "").trim();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;

  // 署名検証（タイミング安全比較）
  const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sigPart);
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  // payload デコード + exp チェック
  try {
    const json = JSON.parse(b64urlDecode(payloadPart).toString("utf8")) as Partial<SsoPayload>;
    const email = typeof json.email === "string" ? json.email.trim().toLowerCase() : "";
    const exp = typeof json.exp === "number" ? json.exp : 0;
    if (!email || !exp || Date.now() > exp) return null;
    return { email, exp };
  } catch {
    return null;
  }
}
