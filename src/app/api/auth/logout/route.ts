import { NextResponse } from "next/server";
import { destroyCurrentSession, sessionCookieName } from "@/lib/auth";

export async function POST() {
  await destroyCurrentSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(sessionCookieName);
  return res;
}
