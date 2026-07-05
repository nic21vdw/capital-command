import { NextResponse } from "next/server";
import { updateYoutubeVideoTitle } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/publish/:id — rename a scheduled post. The new title is saved on
 * the queue item, and when the video is already on YouTube (uploaded as
 * scheduled, or published) it is renamed there too via videos.update. A
 * YouTube failure still keeps the local rename and is reported in the
 * response instead of failing the request.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }
  let body: { title?: unknown };
  try {
    body = (await request.json()) as { title?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // 100 characters is YouTube's title limit; the queue stores what YouTube gets.
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : "";
  if (!title) return NextResponse.json({ error: "A non-empty title is required." }, { status: 400 });

  const queue = publishQueue(config);
  const { id } = await params;
  const item = await queue.get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  item.title = title;
  await queue.add(item);

  const postId = item.platforms.youtube?.postId;
  if (!postId) return NextResponse.json({ item, youtube: "local" });
  try {
    await updateYoutubeVideoTitle(postId, title);
    return NextResponse.json({ item, youtube: "updated" });
  } catch (error) {
    return NextResponse.json({
      item,
      youtube: "error",
      youtubeError: error instanceof Error ? error.message : String(error)
    });
  }
}

/** DELETE /api/publish/:id — drop a scheduled post from the queue. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }
  const { id } = await params;
  const removed = await publishQueue(config).remove(id);
  if (!removed) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  return NextResponse.json({ removed: true });
}
