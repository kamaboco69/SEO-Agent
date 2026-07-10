import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const wfs = await prisma.contentWorkflow.findMany({
  where: { origin: "schedule" },
  orderBy: { createdAt: "desc" },
  include: { steps: { orderBy: { createdAt: "asc" } }, media: { select: { name: true, scheduleLastRunAt: true } } },
});
for (const wf of wfs) {
  const done = wf.steps.filter((s) => s.output && Object.keys(s.output).length > 0).length;
  console.log(`[${wf.media?.name}] ${wf.selectedArticle ?? "(テーマ選定中)"}`);
  console.log(`  status=${wf.status} steps=${done}/${wf.steps.length} wpPostId=${wf.wpPostId} gdoc=${wf.gdocUrl ? "yes" : "no"} images=${wf.imagesGenerated}`);
  console.log(`  title=${wf.finalArticleTitle ?? "-"}`);
  console.log(`  wpEdit=${wf.wpEditLink ?? "-"}`);
  console.log(`  createdAt=${wf.createdAt.toISOString()} wordTarget=${wf.targetWordCount}`);
}
if (wfs.length === 0) console.log("no scheduled workflows yet");
await prisma.$disconnect();
