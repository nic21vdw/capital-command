import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { carouselImageContentType, carouselImagePath } from "@/lib/carousels/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves one uploaded slide photo. `carouselImagePath` only resolves ids of the
 * shape this store writes, so a slide can never point the renderer at a file
 * outside the batch directory.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const target = carouselImagePath(imageId);
  if (!target) return NextResponse.json({ error: "Not a slide photo." }, { status: 404 });

  const size = await stat(target).then(
    (info) => info.size,
    () => null
  );
  if (size === null) return NextResponse.json({ error: "That photo is gone." }, { status: 404 });

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": carouselImageContentType(imageId),
      "Content-Length": String(size),
      // The bytes behind an id never change, so previews and every re-render of
      // the slide reuse the browser's copy.
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
}
