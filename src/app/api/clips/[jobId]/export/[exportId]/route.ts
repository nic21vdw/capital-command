import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { cancelExport, getExport } from "@/lib/clipping/export";
import { outputDir } from "@/lib/clipping/jobs";
import { safeFilename } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stops an in-flight render safely (kills ffmpeg) and marks it canceled. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; exportId: string }> }
) {
  const { jobId, exportId } = await params;
  const record = getExport(exportId);
  if (!record || record.jobId !== jobId) {
    return NextResponse.json({ error: "Export not found. It may have expired after a server restart." }, { status: 404 });
  }
  return NextResponse.json({ export: cancelExport(exportId) });
}

/** Export status, or the produced file when `?file=1`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; exportId: string }> }
) {
  const { jobId, exportId } = await params;
  const record = getExport(exportId);
  if (!record || record.jobId !== jobId) {
    return NextResponse.json({ error: "Export not found. It may have expired after a server restart." }, { status: 404 });
  }

  const wantsFile = request.nextUrl.searchParams.get("file") === "1";
  if (!wantsFile) {
    return NextResponse.json({ export: record });
  }

  if (record.status !== "done" || !record.file) {
    return NextResponse.json({ error: "Export is not finished yet." }, { status: 409 });
  }

  const filePath = path.join(outputDir(jobId), record.file);
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "The exported file no longer exists on disk." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const contentType = record.format === "webm" ? "video/webm" : "video/mp4";
  const ext = record.format === "webm" ? "webm" : "mp4";
  // Name the downloaded file after the project when the client passes a name;
  // otherwise fall back to the generated on-disk filename.
  const requestedName = request.nextUrl.searchParams.get("name");
  const downloadName = requestedName ? `${safeFilename(requestedName)}.${ext}` : record.file;
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      ...(download ? { "Content-Disposition": `attachment; filename="${downloadName}"` } : {})
    }
  });
}
