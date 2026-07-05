import { stat } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/clipping/jobs";
import { configuredPlatforms, hostingConfigured, publisherConfig } from "@/lib/publisher/config";
import { hostMedia } from "@/lib/publisher/hosting";
import { generateClipMetadata } from "@/lib/publisher/metadata";
import { newPlatformState, publishQueue } from "@/lib/publisher/queue";
import { resolvePublishAt } from "@/lib/publisher/time";
import type { PlatformId, QueueItem, Visibility } from "@/lib/publisher/types";

/**
 * enqueue(clip_path, caption, publish_at, platforms) — the single entry point
 * the clipper (or you, via CLI/API) calls when a clip is finished. Missing
 * title/caption/hashtags are generated (Claude when ANTHROPIC_API_KEY is set,
 * heuristic otherwise), the publish time is interpreted in PUBLISH_TIMEZONE,
 * and media is uploaded to the hosting bucket when the item needs a public
 * URL (Instagram always; everything when the queue lives in R2, because the
 * GitHub Actions runner has no access to local files).
 */

export type EnqueueOptions = {
  clipPath: string;
  /** "YYYY-MM-DDTHH:mm" in PUBLISH_TIMEZONE, or full ISO-8601 with offset. */
  publishAt: string | Date;
  caption?: string;
  title?: string;
  hashtags?: string[];
  platforms?: PlatformId[];
  visibility?: Visibility;
  jobId?: string;
  /** Extra context for metadata generation (stream title, topic, spoken text). */
  metadataSource?: { streamTitle?: string; topic?: string; spokenText?: string };
};

export async function enqueue(options: EnqueueOptions): Promise<QueueItem> {
  const config = publisherConfig();
  if (!config.enabled) {
    throw new Error("Publishing is disabled. Set PUBLISH_ENABLED=true in .env to turn it on.");
  }

  const absolute = path.isAbsolute(options.clipPath) ? options.clipPath : path.join(process.cwd(), options.clipPath);
  await stat(absolute).catch(() => {
    throw new Error(`Clip file not found: ${options.clipPath}`);
  });

  const platforms = (options.platforms?.length ? options.platforms : config.platforms).filter(
    (p, i, list) => list.indexOf(p) === i
  );
  if (platforms.length === 0) throw new Error("No platforms selected (check PUBLISH_PLATFORMS).");

  const needsHosting =
    platforms.includes("instagram") ||
    config.queueBackend === "r2" ||
    process.env.TIKTOK_UPLOAD_MODE?.trim().toLowerCase() === "url";
  if (platforms.includes("instagram") && !hostingConfigured(config)) {
    throw new Error(
      "Instagram needs the clip at a public HTTPS URL. Configure S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (Cloudflare R2 free tier) or drop instagram from the platforms."
    );
  }

  const publishAtDate =
    options.publishAt instanceof Date ? options.publishAt : resolvePublishAt(options.publishAt, config.timezone);

  let { title, caption, hashtags } = options;
  if (!title || !caption || !hashtags?.length) {
    const generated = await generateClipMetadata(options.metadataSource ?? { streamTitle: path.basename(absolute) });
    title ??= generated.title;
    caption ??= generated.description;
    hashtags = hashtags?.length ? hashtags : generated.hashtags;
  }

  const id = crypto.randomUUID().slice(0, 8);
  const item: QueueItem = {
    id,
    clipPath: path.relative(process.cwd(), absolute),
    title,
    caption,
    hashtags,
    publishAt: publishAtDate.toISOString(),
    visibility: options.visibility ?? config.defaultVisibility,
    createdAt: new Date().toISOString(),
    jobId: options.jobId,
    platforms: Object.fromEntries(platforms.map((p) => [p, newPlatformState()]))
  };

  if (needsHosting && hostingConfigured(config)) {
    const hosted = await hostMedia(absolute, id);
    item.mediaKey = hosted.key;
  }

  await publishQueue(config).add(item);
  return item;
}

/**
 * Opt-in hook called by the clip export pipeline when an export finishes.
 * Does nothing unless PUBLISH_ENABLED and PUBLISH_AUTO_ENQUEUE are both true,
 * never throws (a publishing hiccup must not fail the export), and schedules
 * the post PUBLISH_AUTO_ENQUEUE_DELAY_MINUTES from now.
 */
export async function maybeAutoEnqueueExport(input: {
  jobId: string;
  exportPath: string;
  spokenText?: string;
}): Promise<QueueItem | null> {
  const config = publisherConfig();
  if (!config.enabled || !config.autoEnqueue) return null;
  try {
    const job = await getJob(input.jobId);
    const item = await enqueue({
      clipPath: input.exportPath,
      publishAt: new Date(Date.now() + config.autoEnqueueDelayMinutes * 60_000),
      jobId: input.jobId,
      platforms: configuredPlatforms(config),
      metadataSource: {
        streamTitle: job?.fileName,
        topic: job?.topic,
        spokenText: input.spokenText
      }
    });
    console.log(`[publisher] auto-enqueued export ${path.basename(input.exportPath)} as item ${item.id}`);
    return item;
  } catch (error) {
    console.warn(
      `[publisher] auto-enqueue skipped for ${path.basename(input.exportPath)}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
