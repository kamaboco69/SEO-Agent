import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type HandoffPayload = Prisma.JsonObject & {
  source: string;
  integration: string;
  generatedAt: string;
  objective: string;
  targetDomain: string | null;
};

function latestPosition(rankings: { position: number; checkedAt: Date }[]) {
  const latest = rankings[0];
  if (!latest) return null;
  return {
    position: latest.position,
    checkedAt: latest.checkedAt.toISOString(),
  };
}

async function buildPayload(body: {
  projectId?: string | null;
  objective: string;
  targetDomain?: string | null;
  requestedDeliverables?: string[];
  contextNotes?: string | null;
}): Promise<HandoffPayload> {
  const project = body.projectId
    ? await prisma.project.findUnique({
        where: { id: body.projectId },
        include: {
          keywords: {
            orderBy: { updatedAt: "desc" },
            include: {
              rankings: {
                orderBy: { checkedAt: "desc" },
                take: 2,
              },
            },
          },
          articles: {
            orderBy: { updatedAt: "desc" },
            take: 10,
          },
        },
      })
    : null;

  const keywordPayload =
    project?.keywords.map((kw) => ({
      id: kw.id,
      keyword: kw.keyword,
      targetUrl: kw.targetUrl,
      latestRanking: latestPosition(kw.rankings),
      previousRanking: kw.rankings[1]
        ? {
            position: kw.rankings[1].position,
            checkedAt: kw.rankings[1].checkedAt.toISOString(),
          }
        : null,
    })) ?? [];

  const articlePayload =
    project?.articles.map((article) => ({
      id: article.id,
      title: article.title,
      targetKw: article.targetKw,
      seoScore: article.seoScore,
      wordCount: article.wordCount,
      metaTitle: article.metaTitle,
      metaDesc: article.metaDesc,
      updatedAt: article.updatedAt.toISOString(),
    })) ?? [];

  return {
    source: "seo-agent",
    integration: "AICompany SEO Analyst",
    generatedAt: new Date().toISOString(),
    objective: body.objective,
    targetDomain: body.targetDomain ?? project?.domain ?? null,
    requestedDeliverables: body.requestedDeliverables ?? [
      "SEO優先課題の整理",
      "キーワード戦略の改善案",
      "コンテンツ改善提案",
      "次の2週間で実行すべきアクション",
    ],
    contextNotes: body.contextNotes ?? null,
    project: project
      ? {
          id: project.id,
          name: project.name,
          domain: project.domain,
          description: project.description,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        }
      : null,
    inventory: {
      trackedKeywordCount: keywordPayload.length,
      articleCount: articlePayload.length,
    },
    keywords: keywordPayload,
    articles: articlePayload,
  };
}

export async function GET() {
  const handoffs = await prisma.analystHandoff.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      project: {
        select: { id: true, name: true, domain: true },
      },
    },
  });

  return NextResponse.json(handoffs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = String(body.title ?? "").trim();
  const objective = String(body.objective ?? "").trim();
  const projectId = body.projectId ? String(body.projectId) : null;
  const targetDomain = body.targetDomain ? String(body.targetDomain).trim() : null;
  const priority = body.priority ? String(body.priority) : "normal";

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!objective) return NextResponse.json({ error: "objective is required" }, { status: 400 });

  if (projectId) {
    const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const payload = await buildPayload({
    projectId,
    objective,
    targetDomain,
    requestedDeliverables: Array.isArray(body.requestedDeliverables)
      ? body.requestedDeliverables.map(String).filter(Boolean)
      : undefined,
    contextNotes: body.contextNotes ? String(body.contextNotes) : null,
  });

  const handoff = await prisma.analystHandoff.create({
    data: {
      projectId,
      title,
      objective,
      targetDomain: targetDomain ?? (payload.targetDomain as string | null),
      priority,
      payload,
      status: "ready",
    },
  });

  return NextResponse.json(handoff, { status: 201 });
}
