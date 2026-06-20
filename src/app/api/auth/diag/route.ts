import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  // 長時間生成テスト（プランの実行時間上限を実測）
  if (req.nextUrl.searchParams.get("gen") === "1" && key) {
    const t = Date.now();
    try {
      const client = new Anthropic({ apiKey: key });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 5000,
        messages: [{ role: "user", content: "日本語で、営業代行の費用相場と選び方についてH2を6個使った3500文字以上のSEO記事をMarkdownで書いてください。" }],
      });
      out.gen = "ok";
      out.genSeconds = Math.round((Date.now() - t) / 1000);
      out.genTokens = msg.usage?.output_tokens ?? null;
    } catch (e) {
      out.gen = "ERROR";
      out.genSeconds = Math.round((Date.now() - t) / 1000);
      out.genError = e instanceof Error ? e.message : "unknown";
    }
  }

  return NextResponse.json(out);
}
