import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import { ensureVerticalClipFile, outputDir } from "@/lib/clipping/jobs";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueue } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";
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
  const items = await publishQueue(config).list();
  return NextResponse.json({ enabled: true, items });
}

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

  let body;
  try {
    body = enqueueSchema.parse(await request.json());
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
