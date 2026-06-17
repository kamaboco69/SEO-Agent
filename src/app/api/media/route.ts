import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function cleanDomain(input: string) {
  return input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function registerWithAICompany(media: {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  audience: string | null;
  tone: string | null;
  mainCategories: unknown;
}) {
  const endpoint = process.env.AI_COMPANY_MEDIA_REGISTER_URL;
  if (!endpoint) {
    return {
      syncStatus: "local_only",
      syncMessage: "AI_COMPANY_MEDIA_REGISTER_URL が未設定のため、SEO Agent内にのみ登録しました",
      aiCompanyMediaId: null,
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AI_COMPANY_WEBHOOK_SECRET
          ? { "x-ai-company-secret": process.env.AI_COMPANY_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        source: "seo-agent",
        localMediaId: media.id,
        name: media.name,
        domain: media.domain,
        description: media.description,
        audience: media.audience,
        tone: media.tone,
        mainCategories: media.mainCategories,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        syncStatus: "failed",
        syncMessage: data.error ?? `AICompany登録に失敗しました (${res.status})`,
        aiCompanyMediaId: null,
      };
    }

    return {
      syncStatus: "synced",
      syncMessage: "AICompanyに登録しました",
      aiCompanyMediaId: data.mediaId ?? data.id ?? null,
    };
  } catch {
    return {
      syncStatus: "failed",
      syncMessage: "AICompany登録APIに接続できませんでした",
      aiCompanyMediaId: null,
    };
  }
}

export async function GET() {
  const media = await prisma.media.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true, domain: true } },
      _count: { select: { workflows: true } },
    },
  });

  return NextResponse.json(media);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const domain = cleanDomain(String(body.domain ?? ""));
  const projectId = body.projectId ? String(body.projectId) : null;
  const mainCategories = Array.isArray(body.mainCategories)
    ? body.mainCategories.map(String).map((item: string) => item.trim()).filter(Boolean)
    : String(body.mainCategories ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const media = await prisma.media.create({
    data: {
      projectId,
      name,
      domain,
      description: body.description ? String(body.description).trim() : null,
      audience: body.audience ? String(body.audience).trim() : null,
      tone: body.tone ? String(body.tone).trim() : null,
      mainCategories,
      syncStatus: "pending",
    },
  });

  const sync = await registerWithAICompany(media);
  const updated = await prisma.media.update({
    where: { id: media.id },
    data: sync,
    include: {
      project: { select: { id: true, name: true, domain: true } },
      _count: { select: { workflows: true } },
    },
  });

  return NextResponse.json(updated, { status: 201 });
}
