import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getProject, projectOutputDir } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9 ._()-]+/gi, "_").slice(0, 120) || "edited-video.mp4";
}

/**
 * Export status, or (`?file=1`) the rendered file itself with HTTP Range
 * support so the done-state preview streams instead of downloading whole.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string; exportId: string }> }) {
  const { projectId, exportId } = await params;
  const project = await getProject(projectId);
  const record = project?.exports.find((item) => item.id === exportId);
  if (!project || !record) {
    return NextResponse.json(
      { error: "Export not found — it may have expired after a server restart. Export again." },
      { status: 404 }
    );
  }

  const wantsFile = request.nextUrl.searchParams.get("file") === "1";
  if (!wantsFile) return NextResponse.json({ export: record });

  if (record.status !== "done" || !record.file) {
    return NextResponse.json({ error: "This export has not finished rendering." }, { status: 409 });
  }
  const filePath = path.join(projectOutputDir(projectId), record.file);
  // The record's file name is server-assigned, but resolve + prefix-check
  // anyway so a corrupted store can never escape the output dir.
  if (!path.resolve(filePath).startsWith(path.resolve(projectOutputDir(projectId)))) {
    return NextResponse.json({ error: "Export file is invalid." }, { status: 400 });
  }
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "The export file is missing. Export again." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const name = safeFilename(request.nextUrl.searchParams.get("name") ?? `${project.name} (edited).mp4`);
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {})
  };

  const range = request.headers.get("range");
  if (range) {
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
        ...baseHeaders,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`
      }
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, { headers: { ...baseHeaders, "Content-Length": String(size) } });
}
