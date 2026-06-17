import { NextResponse } from "next/server";
import { getAiCompanyEntitlement, getCurrentUser, reportAiCompanyUsage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ent = await getAiCompanyEntitlement(user.id, user.email);
  // 今月のトークン使用状況（消費はしない、チェックのみ）
  const usage = await reportAiCompanyUsage(user.email);
  return NextResponse.json({
    ...ent,
    usage: usage.ok ? { usedTokens: usage.usedTokens, limit: usage.limit, allowed: usage.allowed } : null,
  });
}
