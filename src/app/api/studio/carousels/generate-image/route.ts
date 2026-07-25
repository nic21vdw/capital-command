import { NextRequest, NextResponse } from "next/server";
import { saveCarouselAsset } from "@/lib/carousels/assets";
import type { CarouselAspectRatio } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZES: Record<CarouselAspectRatio, string> = {
  portrait: "1024x1280",
  square: "1024x1024",
  story: "1152x2048",
  landscape: "1536x864"
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Add OPENAI_API_KEY to .env.local to generate carousel images." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { prompt?: unknown; ratio?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  const ratio = (typeof body.ratio === "string" && body.ratio in SIZES ? body.ratio : "portrait") as CarouselAspectRatio;
  if (!prompt) return NextResponse.json({ error: "Describe the image first." }, { status: 400 });

  const visualPrompt = [
    "Create a photorealistic editorial image for a social-media carousel.",
    "It should feel candid, energetic, human, and believable rather than like a glossy stock photo.",
    "Use natural camera texture and leave useful negative space for headline copy.",
    "Do not render any words, captions, logos, watermarks, UI, borders, or frames inside the image.",
    `Slide idea: ${prompt}`
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
        prompt: visualPrompt,
        size: SIZES[ratio],
        quality: "medium",
        output_format: "jpeg",
        output_compression: 88
      }),
      signal: AbortSignal.timeout(150_000)
    });

    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };
    const encoded = json.data?.[0]?.b64_json;
    if (!response.ok || !encoded) {
      return NextResponse.json(
        { error: json.error?.message || "OpenAI did not return an image." },
        { status: response.status || 502 }
      );
    }

    const src = await saveCarouselAsset(Buffer.from(encoded, "base64"), "jpg");
    return NextResponse.json({ src });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Image generation timed out. Try again."
        : error instanceof Error
          ? error.message
          : "Could not generate the image.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
