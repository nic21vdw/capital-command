import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { ACCEPTED_VIDEO_TYPES, createJob, listJobs, MAX_UPLOAD_BYTES } from "@/lib/clipping/jobs";

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
    // Cheap availability probe so a missing binary fails before a 500MB read.
    await runFfmpeg(["-version"], { allowFailure: true });
  } catch {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload with a `video` file field." }, { status: 400 });
  }

  const file = form.get("video");
  const topic = String(form.get("topic") ?? "").trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No video file was attached." }, { status: 400 });
  }
  if (!ACCEPTED_VIDEO_TYPES.has(file.type) && !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type || file.name}". Upload MP4, MOV, WebM, MKV, or AVI.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `The file is ${(file.size / 1_000_000).toFixed(0)}MB; the limit is 500MB. Trim or compress it first.` },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const job = await createJob(file.name, topic || undefined, bytes);
  return NextResponse.json({ job }, { status: 201 });
}
