import { NextResponse } from "next/server";
import { getCurrentUser, syncAiCompanyProfileByEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  let user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // AICompany側で更新されたメディア・会社設定を最新化してから返す。
  if (process.env.AI_COMPANY_PROFILE_URL) {
    const updated = await syncAiCompanyProfileByEmail(user.id, user.email);
    if (updated) user = (await getCurrentUser()) ?? user;
  }

  return NextResponse.json({
    email: user.email,
    name: user.name,
    providers: user.accounts.map((account) => account.provider),
    aiCompany: user.aiCompany,
  });
}
