import { NextRequest, NextResponse } from "next/server";
import { extractCarouselFrames } from "@/lib/carousels/frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    sourceType?: unknown;
    sourceId?: unknown;
    count?: unknown;
  };
  const sourceType = typeof body.sourceType === "string" ? body.sourceType : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const count = Math.max(4, Math.min(12, Math.round(Number(body.count) || 8)));

  try {
    const frames = await extractCarouselFrames({ sourceType, sourceId, count });
    return NextResponse.json({ frames });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not extract stream frames.";
    const status = message.includes("not available") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
