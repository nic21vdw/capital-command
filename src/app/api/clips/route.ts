import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, createJobFromUrl, jobWithoutCaptions, listJobs } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every job, WITHOUT its source captions. A stream's word-level transcript is
 * ~98% of a job's weight, and several pages poll this list every few seconds —
 * shipping the transcripts here served nobody and blocked the server for the
 * whole app. A page that needs one job's captions asks
 * `/api/clips/<jobId>/captions` for that job alone.
 */
export async function GET() {
  return NextResponse.json({ jobs: (await listJobs()).map(jobWithoutCaptions) });
}

export async function POST(request: NextRequest) {
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  try {
    // Cheap availability probe so a missing binary fails fast.
    await runFfmpeg(["-version"], { allowFailure: true });
  } catch {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }

  let body: {
    url?: unknown;
    topic?: unknown;
    sourceId?: unknown;
    clipCount?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `url` or `sourceId` field." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  // The creator-chosen number of clips; clamped into the supported range by the
  // job layer, so out-of-range or missing values fall back to the default.
  const clipCount = typeof body.clipCount === "number" ? body.clipCount : undefined;

  if (sourceId) {
    try {
      const job = await createJobFromUpload(sourceId, topic || undefined, clipCount);
      return NextResponse.json({ job }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not start a job from that upload." },
        { status: 400 }
      );
    }
  }

  if (!/^https?:\/\/\S+$/i.test(url)) {
    return NextResponse.json({ error: "Enter a valid http(s) video/VOD URL." }, { status: 400 });
  }

  const job = await createJobFromUrl(url, topic || undefined, clipCount);
  return NextResponse.json({ job }, { status: 201 });
}
