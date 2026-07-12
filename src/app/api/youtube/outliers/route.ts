import { NextRequest, NextResponse } from "next/server";
import { competitorInsightsConfigured } from "@/lib/youtube/competitor-insights";
import { outlierConfigSchema } from "@/lib/youtube/outliers";
import { youtubeConfigured } from "@/lib/youtube/outlier-service";
import { readOutlierStore, updateOutlierStore } from "@/lib/youtube/outlier-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/youtube/outliers — the Outlier Radar's persisted state.
 * GET returns everything the page needs in one request; PATCH updates either
 * an outlier's manual tag ({ videoId, tag }) or the scan config ({ config }).
 */

export async function GET() {
  const store = await readOutlierStore();
  return NextResponse.json({ ...store, configured: youtubeConfigured(), insightsConfigured: competitorInsightsConfigured() });
}

export async function PATCH(request: NextRequest) {
  let body: { videoId?: string; tag?: string; config?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.videoId === "string") {
    if (typeof body.tag !== "string") {
      return NextResponse.json({ error: "tag must be a string." }, { status: 400 });
    }
    const tag = body.tag.slice(0, 500);
    let found = false;
    const store = await updateOutlierStore((current) => ({
      ...current,
      outliers: current.outliers.map((outlier) => {
        if (outlier.videoId !== body.videoId) return outlier;
        found = true;
        return { ...outlier, tag };
      })
    }));
    if (!found) return NextResponse.json({ error: "No flagged outlier with that video id." }, { status: 404 });
    return NextResponse.json({ outliers: store.outliers });
  }

  if (body.config !== undefined) {
    const parsed = outlierConfigSchema.safeParse(body.config);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid config: multiplier ≥ 1, baseline window 3-50 videos, cooldown ≥ 0 minutes." },
        { status: 400 }
      );
    }
    const store = await updateOutlierStore((current) => ({ ...current, config: parsed.data }));
    return NextResponse.json({ config: store.config });
  }

  return NextResponse.json({ error: "Provide { videoId, tag } or { config }." }, { status: 400 });
}
