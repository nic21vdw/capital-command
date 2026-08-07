import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { ingestOverview } from "@/lib/ingest/service";
import { readAppData } from "@/lib/storage/store";
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
    const outcome = scan?.lastScanOutcome ?? null;
    // "Not connected" counts: a scan that cannot see the channel is a scan that
    // will never take anything in, which is the same nothing-happened morning.
    const scanFailed = Boolean(outcome && outcome.status !== "ok");
    return NextResponse.json({
      needsAttention:
        overviews.filter((entry) => entry.run.status === "error" || entry.retryable.length > 0).length +
        (scanFailed ? 1 : 0),
      scanFailed,
      scan: outcome,
      working: overviews.filter((entry) => entry.run.status !== "error" && !entry.settled).length
    });
  }
  return NextResponse.json({ runs: overviews });
}

/**
 * The one gate on unattended booking. Read here rather than trusted from the
 * caller: the scan is a separate process and asks for it every time.
 */
async function autoScheduleAllowed(): Promise<boolean> {
  try {
    const data = await readAppData();
    return data.settings.autoScheduleOvernight === true;
  } catch {
    // Cannot read the answer — assume no. Publishing is the expensive mistake.
    return false;
  }
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
  // An unattended run can book itself — but only if he has said so. The scan
  // asks for it on every run it starts; the answer lives in his settings, not in
  // the request, because booking means AI-written titles and posts reaching his
  // channel without him having read them. Off unless switched on.
  const asked = body.queueWhenReady === true;
  const queueWhenReady = asked && (await autoScheduleAllowed());

  try {
    if (sourceId) {
      const run = await createRunFromSource(sourceId, name || undefined);
      if (queueWhenReady) await updateRun(run, { queueWhenReady: true, unattended: true, renderAllSegments: true });
      return NextResponse.json({ run }, { status: 201 });
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return NextResponse.json({ error: "Enter a valid http(s) stream/VOD URL, or upload a file." }, { status: 400 });
    }
    const run = await createRunFromUrl(url, name || undefined);
    if (queueWhenReady) await updateRun(run, { queueWhenReady: true, unattended: true, renderAllSegments: true });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start the pipeline." },
      { status: 400 }
    );
  }
}
