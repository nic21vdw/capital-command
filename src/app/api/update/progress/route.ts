import { NextResponse } from "next/server";
import { readReleaseProgress } from "@/lib/release/progress";
import { releaseRuntime } from "@/lib/release/runtime";
import { isReleaseInFlight } from "@/lib/release/run";
import { releaseStillRunning } from "@/lib/release/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness and restart polling must not fetch remotes or render the pipeline.
export async function GET() {
  const progress = await readReleaseProgress();
  return NextResponse.json({
    ...releaseRuntime(),
    progress,
    updating: releaseStillRunning(isReleaseInFlight(), progress)
  }, { headers: { "Cache-Control": "no-store" } });
}
