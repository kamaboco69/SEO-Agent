import { NextRequest, NextResponse } from "next/server";
import { connectIdentityToUser, getCurrentUser } from "@/lib/auth";

type VerifiedIdentity = {
  ok?: boolean;
  aiCompanyId?: string;
  email?: string;
  name?: string;
  defaultDomain?: string;
  defaultProjectName?: string;
  defaultObjective?: string;
  defaultContext?: string;
  settings?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const verifyUrl = process.env.AI_COMPANY_ID_VERIFY_URL;
  if (!verifyUrl) {
    return NextResponse.json({ error: "AI_COMPANY_ID_VERIFY_URL is not configured" }, { status: 503 });
  }

  const body = await req.json();
  const aiCompanyId = String(body.aiCompanyId ?? "").trim();
  const verificationCode = String(body.verificationCode ?? "").trim();

  if (!aiCompanyId) return NextResponse.json({ error: "aiCompanyId is required" }, { status: 400 });
  if (!verificationCode) return NextResponse.json({ error: "verificationCode is required" }, { status: 400 });

  const verifyRes = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AI_COMPANY_WEBHOOK_SECRET
        ? { "x-ai-company-secret": process.env.AI_COMPANY_WEBHOOK_SECRET }
        : {}),
    },
    body: JSON.stringify({ aiCompanyId, verificationCode, source: "seo-agent" }),
  });
  const verified = await verifyRes.json().catch(() => ({})) as VerifiedIdentity;

  if (!verifyRes.ok || !verified.ok || !verified.email || !verified.aiCompanyId) {
    return NextResponse.json({ error: "AICompany ID verification failed" }, { status: 401 });
  }

  await connectIdentityToUser(currentUser.id, {
    provider: "aicompany",
    providerAccountId: verified.aiCompanyId,
    email: verified.email,
    name: verified.name ?? null,
    aiCompany: {
      aiCompanyId: verified.aiCompanyId,
      displayName: verified.name ?? null,
      defaultDomain: verified.defaultDomain ?? null,
      defaultProjectName: verified.defaultProjectName ?? null,
      defaultObjective: verified.defaultObjective ?? null,
      defaultContext: verified.defaultContext ?? null,
      settings: verified.settings ?? {},
    },
  });

  return NextResponse.json({ ok: true });
}
