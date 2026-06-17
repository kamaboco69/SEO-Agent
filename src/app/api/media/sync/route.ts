import { NextResponse } from "next/server";
import { getCurrentUser, syncAiCompanyProfileByEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function cleanDomain(input: string) {
  return input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

interface AiMedia {
  name?: string;
  url?: string;
  description?: string | null;
}

// AICompanyに登録済みのメディアを seo-agent の Media に取り込む。
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 最新のAICompany設定を取り込み
  if (process.env.AI_COMPANY_PROFILE_URL) {
    await syncAiCompanyProfileByEmail(user.id, user.email);
  }

  const profile = await prisma.aiCompanyProfile.findUnique({ where: { userId: user.id } });
  const settings = (profile?.settings ?? {}) as { media?: AiMedia[] };
  const list = Array.isArray(settings.media) ? settings.media : [];

  let imported = 0;
  for (const m of list) {
    const domain = cleanDomain(String(m.url ?? ""));
    const name = String(m.name ?? "").trim() || domain;
    if (!domain) continue;

    const existing = await prisma.media.findFirst({
      where: {
        OR: [
          { aiCompanyMediaId: domain },
          { domain },
        ],
      },
    });

    if (existing) {
      await prisma.media.update({
        where: { id: existing.id },
        data: {
          name,
          domain,
          description: m.description ?? existing.description,
          aiCompanyMediaId: domain,
          syncStatus: "synced",
          syncMessage: "AICompanyから同期",
        },
      });
    } else {
      await prisma.media.create({
        data: {
          name,
          domain,
          description: m.description ?? null,
          aiCompanyMediaId: domain,
          syncStatus: "synced",
          syncMessage: "AICompanyから同期",
        },
      });
      imported += 1;
    }
  }

  const media = await prisma.media.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { workflows: true } } },
  });

  return NextResponse.json({ ok: true, imported, total: list.length, media });
}
