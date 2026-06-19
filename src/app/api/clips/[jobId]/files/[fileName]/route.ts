import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getJob, outputDir } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const known = job.clips.map((clip) => clip.file).filter(Boolean);
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
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    // Without this, inline <video> playback in Chrome often drops the audio
    // track because it can't range-fetch the MP4's audio sample tables.
    "Accept-Ranges": "bytes",
    ...(download ? { "Content-Disposition": `attachment; filename="${jobId}-${fileName}"` } : {})
  };

  // Honour HTTP Range requests so browsers can stream and seek the clip
  // (and reliably play its audio) without downloading the whole file first.
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match && (match[1] !== "" || match[2] !== "")) {
      let start = match[1] === "" ? NaN : Number(match[1]);
      let end = match[2] === "" ? NaN : Number(match[2]);

      if (Number.isNaN(start)) {
        // Suffix range: bytes=-N → the final N bytes.
        start = Math.max(0, size - end);
        end = size - 1;
      } else if (Number.isNaN(end)) {
        end = size - 1;
      }

      if (start > end || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" }
        });
      }

      end = Math.min(end, size - 1);
      const chunkSize = end - start + 1;
      const partial = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
      return new NextResponse(partial, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(chunkSize)
        }
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size)
    }
  });
}
