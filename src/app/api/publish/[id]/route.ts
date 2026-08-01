import { NextResponse } from "next/server";
import { z } from "zod";
import { accountIdConfigured, getAccount, primaryAccountId } from "@/lib/publisher/accounts";
import { updateYoutubeVideoTitle } from "@/lib/publisher/adapters/youtube";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { applyRevision, reviseRefusal, type ReviseContext, type RevisePatch } from "@/lib/publisher/revise";
import { ALL_PLATFORMS, type PlatformId } from "@/lib/publisher/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  // 100 characters is YouTube's title limit; the queue stores what YouTube gets.
  title: z.string().max(100).optional(),
  publishAt: z.string().min(1).optional(),
  caption: z.string().max(5000).optional(),
  hashtags: z.array(z.string()).max(30).optional(),
  visibility: z.enum(["public", "private", "unlisted"]).optional(),
  accountId: z.string().min(1).optional(),
  platforms: z.array(z.enum(["youtube", "instagram", "tiktok", "facebook"])).optional()
});

/**
 * PATCH /api/publish/:id — revise a scheduled post.
 *
 * Any subset of title, publishAt, caption, hashtags, visibility, accountId and
 * the platform target set; an absent field is left alone, so the UI can send
 * only the control the user touched. What may change is decided by revise.ts —
 * the short version is that a post which has already left the app can only be
 * renamed.
 *
 * The rename half predates this and is unchanged: when the video is already on
 * YouTube (uploaded as scheduled, or published) it is renamed there too via
 * videos.update, and a YouTube failure still keeps the local rename and is
 * reported in the response instead of failing the request.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }

  let patch: RevisePatch;
  try {
    patch = patchSchema.parse(await request.json());
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0]?.message : null;
    return NextResponse.json({ error: issue ?? "Invalid request body." }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const queue = publishQueue(config);
  const { id } = await params;
  const item = await queue.get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });

  const context: ReviseContext = {};
  if (patch.accountId !== undefined) {
    const account = await getAccount(patch.accountId);
    if (!account) {
      return NextResponse.json({ error: "That account no longer exists — pick another one." }, { status: 400 });
    }
    context.accountPlatform = account.platform;
  }

  const refusal = reviseRefusal(item, patch, context);
  // 409, not 400: the request was well formed, the post's own state refused it.
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  // Only needed when targets are being added — a new platform lands as
  // "pending" or as a "manual" reminder depending on whether it can post.
  if (patch.platforms !== undefined) {
    const accountId = patch.accountId ?? item.accountId;
    const configured: PlatformId[] = [];
    for (const platform of ALL_PLATFORMS) {
      if (!patch.platforms.includes(platform)) continue;
      if (await accountIdConfigured(platform, accountId ?? primaryAccountId(platform), config)) {
        configured.push(platform);
      }
    }
    context.configured = configured;
  }

  const revised = applyRevision(item, patch, context);
  await queue.add(revised);

  const renamed = patch.title !== undefined && revised.title !== item.title;
  const postId = revised.platforms.youtube?.postId;
  if (!renamed || !postId) return NextResponse.json({ item: revised, youtube: "local" });
  try {
    await updateYoutubeVideoTitle(postId, revised.title, revised.accountId);
    return NextResponse.json({ item: revised, youtube: "updated" });
  } catch (error) {
    return NextResponse.json({
      item: revised,
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
