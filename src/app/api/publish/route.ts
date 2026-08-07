import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import { ensureVerticalClipFile, outputDir } from "@/lib/clipping/jobs";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueue } from "@/lib/publisher/enqueue";
import { FAILED_RETENTION_DAYS, publishQueue } from "@/lib/publisher/queue";
import { connectRearmScope, rearmItems } from "@/lib/publisher/rearm";
import { runDue, type RunReport } from "@/lib/publisher/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The post-enqueue upload streams the whole clip to YouTube.
export const maxDuration = 300;

/** GET /api/publish — the queue with per-platform status. */
export async function GET() {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, items: [] });
  }
  // A permanently-failed post STAYS on the board with its reason, so the
  // failure is something you see and can retry rather than something that
  // silently emptied its slot. Reading the board is what stamps the failure as
  // seen; only a seen failure older than the retention window is swept.
  const queue = publishQueue(config);
  const now = new Date();
  await queue.markFailedSeen(now);
  const purged = await queue.purgeFailed(now);
  if (purged.length > 0) {
    console.log(
      `[publisher] swept ${purged.length} failed post(s) older than ${FAILED_RETENTION_DAYS} days: ${purged
        .map((item) => item.id)
        .join(", ")}`
    );
  }
  const items = await queue.list();
  return NextResponse.json({ enabled: true, items });
}

/**
 * The non-enqueue things POST does.
 *
 *   retry  put one post's failed/manual platforms back to pending, so the
 *          board's Publish now (or the next scheduler pass) acts on it again
 *   rearm  the same across the queue for one platform+account — what a connect
 *          flow calls once credentials exist, so work blocked as "manual" or
 *          by a dead token comes back instead of needing to be re-scheduled
 */
const actionSchema = z.object({
  action: z.enum(["retry", "rearm"]),
  itemId: z.string().min(1).optional(),
  platform: z.enum(["youtube", "instagram", "tiktok", "facebook"]).optional(),
  accountId: z.string().min(1).optional()
});

const enqueueSchema = z.object({
  // Either a jobId + file (a clip rendered/exported by the clipper) …
  jobId: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  // … or an explicit path relative to the project root.
  clipPath: z.string().min(1).optional(),
  publishAt: z.string().min(1),
  title: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  hashtags: z.array(z.string()).optional(),
  platforms: z.array(z.enum(["youtube", "instagram", "tiktok", "facebook"])).optional(),
  visibility: z.enum(["public", "private", "unlisted"]).optional(),
  accountId: z.string().min(1).optional()
});

/**
 * POST /api/publish — enqueue a finished clip for scheduled publishing, then
 * immediately process whatever is already due on it. YouTube counts as due
 * the moment it's queued (the upload goes up private with status.publishAt,
 * so it appears in YouTube Studio as Scheduled right away and YouTube flips
 * it live at the slot time); TikTok/Instagram stay queued until their time.
 * An upload failure doesn't fail the enqueue — the item stays queued and the
 * scheduler retries.
 */
export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid enqueue request." }, { status: 400 });
  }

  const action = actionSchema.safeParse(raw);
  if (action.success) return handleAction(action.data, config);

  let body;
  try {
    body = enqueueSchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid enqueue request." }, { status: 400 });
  }

  let clipPath = body.clipPath;
  if (!clipPath && body.jobId && body.file) {
    // Only allow files that actually live inside the job's output folder.
    const base = outputDir(body.jobId);
    const resolved = path.resolve(base, body.file);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) {
      return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
    }
    // Shorts guarantee: clips always post as 9:16 verticals. If the picked
    // file is widescreen (e.g. an old job that only has the 16:9 master),
    // render the centered + blurred-fill vertical now and post that instead.
    try {
      const verticalFile = await ensureVerticalClipFile(body.jobId, body.file);
      clipPath = path.resolve(base, verticalFile);
    } catch (error) {
      return NextResponse.json(
        {
          error: `Could not prepare the 9:16 vertical render for this clip: ${
            error instanceof Error ? error.message : String(error)
          }`
        },
        { status: 400 }
      );
    }
  }
  if (!clipPath) {
    return NextResponse.json({ error: "Provide either clipPath or jobId + file." }, { status: 400 });
  }

  let item;
  try {
    item = await enqueue({
      clipPath,
      publishAt: body.publishAt,
      title: body.title,
      caption: body.caption,
      hashtags: body.hashtags,
      platforms: body.platforms,
      visibility: body.visibility,
      jobId: body.jobId,
      accountId: body.accountId
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  let report: RunReport | undefined;
  try {
    report = await runDue(new Date(), { itemId: item.id });
  } catch (error) {
    console.warn(
      `[publisher] immediate run for ${item.id} failed (the scheduler will retry): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // Re-read so the response carries the post-upload platform states.
  const saved = await publishQueue(config).get(item.id);
  return NextResponse.json({ item: saved ?? item, report }, { status: 201 });
}

async function handleAction(
  { action, itemId, platform, accountId }: z.infer<typeof actionSchema>,
  config: ReturnType<typeof publisherConfig>
) {
  const queue = publishQueue(config);

  if (action === "retry") {
    if (!itemId) return NextResponse.json({ error: '"retry" needs the id of a scheduled post.' }, { status: 400 });
    const item = await queue.get(itemId);
    if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
    const platforms = await queue.rearm(item, { platform });
    if (platforms.length === 0) {
      return NextResponse.json({ error: "Nothing on that post is waiting to be retried." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, item: await queue.get(itemId), platforms });
  }

  if (!platform) return NextResponse.json({ error: '"rearm" needs a platform.' }, { status: 400 });
  // Scoped to failures a connection fixes: a rejected video stays rejected, or
  // one reconnect would march every dead post back into the queue.
  const changed = rearmItems(await queue.list(), connectRearmScope(platform, accountId));
  if (changed.length > 0) await queue.save();
  return NextResponse.json({
    ok: true,
    recovered: changed.length,
    itemIds: changed.map((entry) => entry.item.id)
  });
}
