import { NextResponse } from "next/server";
import { disconnectAiCompany, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// AICompany連携を解除。以後は自動再連携されない（再連携は連携ボタンから）。
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await disconnectAiCompany(user.id);
  return NextResponse.json({ ok: true });
}
