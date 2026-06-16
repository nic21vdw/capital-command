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
  const known = job.clips.flatMap((clip) => [clip.file, clip.wideFile, clip.srtFile]).filter(Boolean);
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

  const isVideo = fileName.endsWith(".mp4");
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(stream, {
    headers: {
      "Content-Type": isVideo ? "video/mp4" : "application/x-subrip",
      "Content-Length": String(size),
      ...(download ? { "Content-Disposition": `attachment; filename="${jobId}-${fileName}"` } : {})
    }
  });
}
