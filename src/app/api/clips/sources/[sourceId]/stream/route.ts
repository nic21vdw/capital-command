import { parseByteRange } from "@/lib/clipping/byte-range";
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
    const parsed = parseByteRange(range, size);
    if (!parsed) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const { start, end } = parsed;
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

  const stream = size > 0 ? Readable.toWeb(openSourceRange(meta, 0, size - 1)) as ReadableStream : null;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600"
    }
  });
}

