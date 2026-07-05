import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listGa4Properties } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// 既存GA4プロパティ一覧（紐付け用）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const res = await listGa4Properties();
  return NextResponse.json({ properties: res?.properties ?? [] });
}
