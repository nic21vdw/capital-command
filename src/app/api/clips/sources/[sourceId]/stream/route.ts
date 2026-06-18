import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { openSourceRange, readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the stored source with HTTP Range support so the browser <video>
 * element streams and seeks instead of downloading the whole file. This is what
 * keeps 90-minute sources out of browser memory.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const meta = await readSourceMeta(sourceId);
  if (!meta) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  let size: number;
  try {
    size = (await stat(sourceFilePath(meta))).size;
  } catch {
    return NextResponse.json({ error: "Source file is missing." }, { status: 404 });
  }

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
    const stream = Readable.toWeb(openSourceRange(meta, start, end)) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": meta.mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600"
      }
    });
  }

  const stream = Readable.toWeb(openSourceRange(meta, 0, size - 1)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600"
    }
  });
}
