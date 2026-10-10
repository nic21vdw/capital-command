import { NextResponse } from "next/server";
import { holdYoutubeVideoPrivate, updateYoutubeVideoTitle } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabled";
import { publishQueue } from "@/lib/publisher/queue";
import { removalImpact } from "@/lib/publisher/boardActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/publish/:id — edit a scheduled post's title, caption or hashtags.
 * The edit is saved on the queue item. A new title on a video already on
 * YouTube (uploaded as scheduled, or published) renames it there too via
 * videos.update; a YouTube failure still keeps the local edit and is reported
 * in the response instead of failing the request.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });
  }
  let body: { title?: unknown; caption?: unknown; hashtags?: unknown };
  try {
    const raw = await request.json();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Expected an object with a title, caption or hashtags." }, { status: 400 });
    }
    body = raw as { title?: unknown; caption?: unknown; hashtags?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // 100 characters is YouTube's title limit; the queue stores what YouTube gets.
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : undefined;
  const caption = typeof body.caption === "string" ? body.caption.trim() : undefined;
  const hashtags =
    Array.isArray(body.hashtags) && body.hashtags.every((tag) => typeof tag === "string")
      ? (body.hashtags as string[])
      : undefined;
  if (title === "" || caption === "") {
    return NextResponse.json({ error: "Title and caption cannot be empty." }, { status: 400 });
  }
  if (title === undefined && caption === undefined && hashtags === undefined) {
    return NextResponse.json({ error: "Send a title, a caption or hashtags." }, { status: 400 });
  }

  const queue = publishQueue(config);
  const { id } = await params;
  const item = await queue.get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  const renamed = title !== undefined && title !== item.title;
  if (title !== undefined) item.title = title;
  if (caption !== undefined) item.caption = caption;
  if (hashtags !== undefined) item.hashtags = hashtags;
  await queue.add(item, renamed ? "api-publish-rename" : "api-publish-edit");

  const postId = item.platforms.youtube?.postId;
  if (!renamed || !postId) return NextResponse.json({ item, youtube: "local" });
  try {
    await updateYoutubeVideoTitle(postId, item.title, item.accountId);
    return NextResponse.json({ item, youtube: "updated" });
  } catch (error) {
    return NextResponse.json({
      item,
      youtube: "error",
      youtubeError: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * DELETE /api/publish/:id — drop a scheduled post from the queue, every
 * platform on it.
 *
 * The queue forgetting a post does not stop a platform that already holds it:
 *  - YouTube: a video uploaded with a go-live time would still publish. Remove
 *    clears that time first (the existing hold-private write), so the video
 *    stays private on the channel - reversible in Studio, never deleted. If
 *    that write fails the post is NOT removed (it would still go live), and
 *    `?anyway=1` removes it regardless.
 *  - Facebook: a Reel or picture post it holds cannot be cancelled from here.
 *    The response flags it so the board can say so and link Meta Business Suite.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });
  }
  const { id } = await params;
  const queue = publishQueue(config);
  const item = await queue.get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });

  const impact = removalImpact(item);
  let youtube: "none" | "held" | "already-private" | "already-public" | "missing" | "unchecked" = "none";
  let youtubeError: string | undefined;
  if (impact.youtube) {
    try {
      youtube = await holdYoutubeVideoPrivate(impact.youtube.postId, item.accountId);
    } catch (error) {
      youtubeError = error instanceof Error ? error.message : String(error);
      if (new URL(request.url).searchParams.get("anyway") !== "1") {
        return NextResponse.json(
          {
            error: `Not removed: YouTube already has this video and it could not be kept private (${youtubeError}). It would still go live at its slot.`,
            code: "youtube-hold-failed",
            youtubeVideoId: impact.youtube.postId
          },
          { status: 502 }
        );
      }
      youtube = "unchecked";
    }
  }

  const removed = await queue.remove(id, "api-publish-delete");
  if (!removed) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  return NextResponse.json({
    removed: true,
    youtube,
    youtubeVideoId: impact.youtube?.postId,
    youtubeError,
    facebookPostId: impact.facebook?.postId
  });
}
