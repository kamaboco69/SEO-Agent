import { NextResponse } from "next/server";
import { getAiCompanyEntitlement, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ent = await getAiCompanyEntitlement(user.id, user.email);
  return NextResponse.json(ent);
}
