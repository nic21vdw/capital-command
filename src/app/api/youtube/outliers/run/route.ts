import { NextRequest, NextResponse } from "next/server";
import { OutlierApiError, runOutlierScan } from "@/lib/youtube/outlier-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/youtube/outliers/run — pull fresh stats for the watchlist,
 * recompute baselines, and flag outliers. Channels fetched within the
 * cooldown window are served from cache; ?force=1 bypasses that.
 */
export async function POST(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { store, run } = await runOutlierScan({ force });
    return NextResponse.json({ ...store, run });
  } catch (error) {
    if (error instanceof OutlierApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
