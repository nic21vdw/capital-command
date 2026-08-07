import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { ingestOverview } from "@/lib/ingest/service";
import { createRunFromSource, createRunFromUrl, listRuns, overviewContext, runOverview, updateRun } from "@/lib/pipeline/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline — every run joined with the live state of its long-form
 * project, clip job, and outputs. Polling this is what advances the runs.
 */
export async function GET(request: NextRequest) {
  const runs = await listRuns();
  // One app-data read and one queue read for the whole poll, not one per run.
  const context = overviewContext();
  const overviews = await Promise.all(runs.map((run) => runOverview(run, context)));
  // `?summary=1` is what the sidebar badge polls: the same advance, a few bytes
  // back instead of every stage of every run.
  if (request.nextUrl.searchParams.has("summary")) {
    // A scan that failed before it created any run has no run to count — and it
    // is the failure most likely to happen overnight, so it has to reach the
    // same badge rather than only the panel on /agents.
    const scan = await ingestOverview().catch(() => null);
    const scanFailed = scan?.lastScan?.status === "failed" || Boolean(scan?.lastScan?.needsReconnect);
    return NextResponse.json({
      needsAttention:
        overviews.filter((entry) => entry.run.status === "error" || entry.retryable.length > 0).length +
        (scanFailed ? 1 : 0),
      scanFailed,
      working: overviews.filter((entry) => entry.run.status !== "error" && !entry.settled).length
    });
  }
  return NextResponse.json({ runs: overviews });
}

/** POST /api/pipeline — start a run from a VOD `url` or an uploaded `sourceId`. */
export async function POST(request: NextRequest) {
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }

  let body: { url?: unknown; sourceId?: unknown; name?: unknown; queueWhenReady?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `url` or `sourceId` field." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // An unattended run books itself. The nightly scan runs while he is asleep,
  // so waiting for two button presses is the app doing the first nine tenths of
  // the work and stopping. It stays opt-out from the run's Scheduler row.
  const queueWhenReady = body.queueWhenReady === true;

  try {
    if (sourceId) {
      const run = await createRunFromSource(sourceId, name || undefined);
      if (queueWhenReady) await updateRun(run, { queueWhenReady: true });
      return NextResponse.json({ run }, { status: 201 });
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return NextResponse.json({ error: "Enter a valid http(s) stream/VOD URL, or upload a file." }, { status: 400 });
    }
    const run = await createRunFromUrl(url, name || undefined);
    if (queueWhenReady) await updateRun(run, { queueWhenReady: true });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the pipeline." },
      { status: 400 }
    );
  }
}
