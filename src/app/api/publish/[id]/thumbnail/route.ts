import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ensureClipThumbnail } from "@/lib/clipping/thumbnails";
import { publisherConfig } from "@/lib/publisher/config";
import { isImagePost } from "@/lib/publisher/images";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/:id/thumbnail — a poster frame for any scheduled video.
 *
 * The board used to reach for the thumbnail of the CLIP JOB a post came from,
 * which meant a card could only show a picture when the post was a clip and
 * that job's folder was still around: a long-form edit, a topic segment, an
 * adopted video or anything queued by the CLI drew an empty box. An empty box
 * on a scheduled post reads as "this didn't work", so it is worth a frame.
 *
 * Addressed by queue id, like the image route — the only input is an item id
 * and the path comes from the queue, so there is nothing here to walk.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await publishQueue(publisherConfig()).get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  if (isImagePost(item)) {
    return NextResponse.json({ error: "That post is pictures — the slides are served by index." }, { status: 404 });
  }

  const stored = item.clipPath;
  const target = path.isAbsolute(stored) ? stored : path.join(process.cwd(), stored);
  const thumbPath = await ensureClipThumbnail(path.dirname(target), path.basename(target));
  if (!thumbPath) {
    return NextResponse.json({ error: "That clip isn't on this machine any more." }, { status: 404 });
  }

  const size = (await stat(thumbPath)).size;
  const stream = Readable.toWeb(createReadStream(thumbPath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600"
    }
  });
}
