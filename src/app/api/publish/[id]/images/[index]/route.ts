import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { IMAGE_CONTENT_TYPES, imagePathsOf, isImagePost } from "@/lib/publisher/images";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/:id/images/:index — one picture of a scheduled image post.
 *
 * A picture post that nothing can publish for you is only useful if you can get
 * at the files, and the rendered slides sit under `data/carousels/<id>/` where
 * the browser cannot reach them. Addressing them by QUEUE POSITION rather than
 * by path is the whole point: the only inputs are an item id and an index into
 * a list the server already holds, so there is no path for a request to walk.
 *
 * `?download=1` saves the file instead of showing it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const item = await publishQueue(publisherConfig()).get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  if (!isImagePost(item)) return NextResponse.json({ error: "That post is a video, not pictures." }, { status: 404 });

  const paths = imagePathsOf(item);
  const position = Number.parseInt(index, 10);
  if (!Number.isInteger(position) || position < 0 || position >= paths.length) {
    return NextResponse.json({ error: "That post has no picture there." }, { status: 404 });
  }

  const stored = paths[position];
  const target = path.isAbsolute(stored) ? stored : path.join(process.cwd(), stored);
  const size = await stat(target).then(
    (info) => info.size,
    () => null
  );
  if (size === null) {
    return NextResponse.json({ error: "That picture isn't on this machine any more." }, { status: 404 });
  }

  const name = path.basename(target);
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": IMAGE_CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${name}"`,
      // A queued deck is repainted in place when its copy is edited, so this
      // must not be the immutable cache the uploaded-photo route can use.
      "Cache-Control": "private, no-cache"
    }
  });
}
