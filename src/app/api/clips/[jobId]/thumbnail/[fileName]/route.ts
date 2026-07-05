import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { ensureClipThumbnail } from "@/lib/clipping/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a poster frame for a rendered clip, extracting it on first request.
 * The clip cards use this as the <video> poster so a project shows real
 * previews immediately instead of black boxes while the mp4s buffer.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; fileName: string }> }
) {
  const { jobId, fileName } = await params;
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Only files the job itself produced may be served — no path traversal.
  const known = job.clips.flatMap((clip) => [
    clip.file,
    ...(clip.variants ?? []).map((variant) => variant.file)
  ]).filter(Boolean);
  if (!known.includes(fileName)) {
    return NextResponse.json({ error: "File not found for this job." }, { status: 404 });
  }

  const thumbPath = await ensureClipThumbnail(outputDir(jobId), fileName);
  if (!thumbPath) {
    return NextResponse.json({ error: "No thumbnail is available for this clip." }, { status: 404 });
  }

  const size = (await stat(thumbPath)).size;
  const stream = Readable.toWeb(createReadStream(thumbPath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      // Thumbnails only change if the clip is re-rendered, so let the browser
      // reuse them across visits instead of refetching every page load.
      "Cache-Control": "private, max-age=3600"
    }
  });
}
