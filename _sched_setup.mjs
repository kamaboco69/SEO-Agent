import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const media = await prisma.media.findMany({ select: { id: true, name: true, domain: true, wpUrl: true, scheduleEnabled: true, scheduleOwnerEmail: true } });
console.log(JSON.stringify(media, null, 1));

const ohyt = media.find((m) => m.domain.includes("ohyt"));
if (ohyt) {
  const updated = await prisma.media.update({
    where: { id: ohyt.id },
    data: {
      scheduleEnabled: true,
      schedulePerMonth: 2,
      scheduleWordCount: 2000,
      scheduleOwnerEmail: "n-ikeda@g-ism.jp",
    },
  });
  console.log("ENABLED:", updated.id, updated.name, updated.schedulePerMonth + "本/月", updated.scheduleWordCount + "字");
}
await prisma.$disconnect();
