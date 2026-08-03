import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { overlayImagePath } from "@/lib/clipping/overlay-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

/**
 * Serves one overlay picture — the watermark or logo burned onto a clip.
 * `overlayImagePath` rejects anything that is not a bare file name, so an
 * overlay can never point at a file outside the store.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const target = overlayImagePath(file);
  if (!target) return NextResponse.json({ error: "Not an overlay image." }, { status: 404 });

  const size = await stat(target).then(
    (info) => info.size,
    () => null
  );
  if (size === null) return NextResponse.json({ error: "That overlay image is gone." }, { status: 404 });

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(size),
      // Files are named by content hash, so the bytes behind a name never change.
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
}
