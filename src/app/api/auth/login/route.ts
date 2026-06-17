import { NextRequest, NextResponse } from "next/server";
import { createSession, sessionCookieName, syncAiCompanyProfileByEmail, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  const user = await verifyPassword(email, password);
  if (!user) {
    return NextResponse.json({ error: "メールアドレスまたはパスワードが違います" }, { status: 401 });
  }

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
