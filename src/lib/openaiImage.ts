// OpenAI gpt-image-1 で画像を生成し、base64(PNG)を返す。

function openAiKey(): string | null {
  return process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY || null;
}

export function imageGenEnabled(): boolean {
  return Boolean(openAiKey());
}

export interface GeneratedImage {
  base64: string; // b64 PNG
  mime: string;
}

// size: gpt-image-1 は 1024x1024 / 1536x1024 / 1024x1536 / auto
export async function generateImage(
  prompt: string,
  size: "1024x1024" | "1536x1024" | "1024x1536" = "1536x1024"
): Promise<GeneratedImage | null> {
  const key = openAiKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt.slice(0, 3800),
        n: 1,
        size,
        quality: "medium",
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.data?.[0]?.b64_json) {
      return null;
    }
    return { base64: data.data[0].b64_json as string, mime: "image/png" };
  } catch {
    return null;
  }
}
