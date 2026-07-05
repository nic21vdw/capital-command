import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getJob, outputDir } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

function contentType(fileName: string): string {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves a rendered clip file with HTTP Range support so the <video> element can
 * seek and stream instead of re-downloading the whole file on every scrub, plus
 * Last-Modified/If-Modified-Since caching so remounting a player (opening the
 * editor, revisiting the project grid) revalidates instead of re-downloading.
 * Both are what keep preview playback instant in the Clip Editor.
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
    clip.previewFile,
    clip.posterFile,
    ...(clip.variants ?? []).map((variant) => variant.file)
  ]).filter(Boolean);
  if (!known.includes(fileName)) {
    return NextResponse.json({ error: "File not found for this job." }, { status: 404 });
  }

  const filePath = path.join(outputDir(jobId), fileName);
  let size: number;
  let mtimeMs: number;
  try {
    const stats = await stat(filePath);
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    return NextResponse.json({ error: "The file no longer exists on disk." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";

  // Rendered files are effectively write-once per name, so let the browser
  // cache them and answer revalidations with 304 instead of a full re-stream.
  const lastModified = new Date(mtimeMs).toUTCString();
  const cacheHeaders: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Last-Modified": lastModified
  };

  const ifModifiedSince = request.headers.get("if-modified-since");
  if (ifModifiedSince && !download) {
    const since = Date.parse(ifModifiedSince);
    // HTTP dates have second precision; compare on whole seconds.
    if (!Number.isNaN(since) && Math.floor(mtimeMs / 1000) * 1000 <= since) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }
  }

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
        ...cacheHeaders,
        "Content-Type": contentType(fileName),
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`
      }
    });
  }

  const headers: Record<string, string> = {
    ...cacheHeaders,
    "Content-Type": contentType(fileName),
    "Content-Length": String(size)
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${jobId}-${fileName}"`;

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, { headers });
}
