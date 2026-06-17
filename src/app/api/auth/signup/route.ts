import { NextRequest, NextResponse } from "next/server";
import { createSession, createUserWithPassword, sessionCookieName, syncAiCompanyProfileByEmail } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const name = body.name ? String(body.name).trim() : null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  let user;
  try {
    user = await createUserWithPassword(email, password, name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "登録に失敗しました" }, { status: 409 });
  }

  // 同じメールのAICompany設定があれば自動連携（解除済みならスキップ）
  await syncAiCompanyProfileByEmail(user.id, user.email);

  const session = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, session.rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
