import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    email: user.email,
    name: user.name,
    providers: user.accounts.map((account) => account.provider),
    aiCompany: user.aiCompany,
  });
}
