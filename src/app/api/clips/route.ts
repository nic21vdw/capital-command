import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, createJobFromUrl, listJobs } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
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
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `url` or `sourceId` field." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";

  if (sourceId) {
    try {
      const job = await createJobFromUpload(sourceId, topic || undefined);
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

  const job = await createJobFromUrl(url, topic || undefined);
  return NextResponse.json({ job }, { status: 201 });
}
