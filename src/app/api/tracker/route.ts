import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const keywords = await prisma.trackedKeyword.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      rankings: {
        orderBy: { checkedAt: "desc" },
        take: 30,
      },
    },
  });

  return NextResponse.json(keywords);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { keyword, targetUrl, projectId } = body;
  if (!keyword) return NextResponse.json({ error: "keyword is required" }, { status: 400 });

  const kw = await prisma.trackedKeyword.create({
    data: { keyword, targetUrl, projectId },
  });

  // 初回チェック（ダミー順位）
  const mockPosition = Math.floor(Math.random() * 50) + 1;
  await prisma.keywordRanking.create({
    data: { keywordId: kw.id, position: mockPosition, url: targetUrl },
  });

  return NextResponse.json(kw);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await prisma.trackedKeyword.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
