import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getJob, outputDir } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a rendered clip file with HTTP Range support so the <video> element can
 * seek and stream instead of re-downloading the whole file on every scrub. Range
 * support is what keeps preview playback responsive in the Clip Editor.
 */
export async function GET(
  request: NextRequest,
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

  const filePath = path.join(outputDir(jobId), fileName);
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "The file no longer exists on disk." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";

  // Honour HTTP Range requests with a 206 partial response so the editor's
  // <video> element can start playing and seek immediately instead of
  // downloading the entire clip first, and large clips never load fully into
  // browser memory.
  const range = request.headers.get("range");
  if (range && !download) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? Number(match[1]) : 0;
    let end = match && match[2] ? Number(match[2]) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-cache"
      }
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache"
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${jobId}-${fileName}"`;

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, { headers });
}
