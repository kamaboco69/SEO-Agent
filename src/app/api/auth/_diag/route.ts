import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

// 本番でAIが動くかの一時診断。?token=<AI_COMPANY_WEBHOOK_SECRET>&ping=1 で起動。
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.AI_COMPANY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const out: Record<string, unknown> = { aiEnabled: Boolean(key), keyLen: key.length };

  if (req.nextUrl.searchParams.get("ping") === "1" && key) {
    try {
      const client = new Anthropic({ apiKey: key });
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      });
      out.ping = "ok";
      out.outTokens = msg.usage?.output_tokens ?? null;
    } catch (e) {
      out.ping = "ERROR";
      out.pingError = e instanceof Error ? e.message : "unknown";
    }
  }
  return NextResponse.json(out);
}
