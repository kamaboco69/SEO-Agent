import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentEmail } from "@/lib/agentBridge";

export const dynamic = "force-dynamic";

// AI Companyブリッジ: 運用メディア一覧（LIFFのメディア選択に使う）
export async function GET(req: NextRequest) {
  if (!agentEmail(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const media = await prisma.media.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, domain: true, wpUrl: true, wpSecret: true, scheduleEnabled: true },
  });
  return NextResponse.json({
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      domain: m.domain,
      wpConnected: Boolean(m.wpUrl && m.wpSecret),
      scheduleEnabled: m.scheduleEnabled,
    })),
  });
}
