import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUrl, listJobs } from "@/lib/clipping/jobs";

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

  let body: { url?: unknown; topic?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `url` field." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return NextResponse.json({ error: "Enter a valid http(s) video/VOD URL." }, { status: 400 });
  }

  const job = await createJobFromUrl(url, topic || undefined);
  return NextResponse.json({ job }, { status: 201 });
}
