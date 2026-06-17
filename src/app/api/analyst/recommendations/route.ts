import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.AI_COMPANY_WEBHOOK_SECRET;
  if (!secret) return true;
  return req.headers.get("x-ai-company-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const handoffId = String(body.handoffId ?? "").trim();
  const recommendation = String(body.recommendation ?? "").trim();
  const analystNotes = body.analystNotes ? String(body.analystNotes) : null;
  const status = body.status ? String(body.status) : "reviewed";

  if (!handoffId) return NextResponse.json({ error: "handoffId is required" }, { status: 400 });
  if (!recommendation) return NextResponse.json({ error: "recommendation is required" }, { status: 400 });

  const handoff = await prisma.analystHandoff.update({
    where: { id: handoffId },
    data: {
      recommendation,
      analystNotes,
      status,
    },
  });

  return NextResponse.json({ ok: true, handoff });
}
