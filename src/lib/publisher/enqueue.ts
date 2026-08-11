import { stat } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/clipping/jobs";
import { accountIdConfigured, getAccount, isPrimaryAccountId, primaryAccountId } from "@/lib/publisher/accounts";
import { configuredPlatforms, hostingConfigured, publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { hostImages, hostMedia } from "@/lib/publisher/hosting";
import {
  MAX_IMAGES_PER_POST,
  isSupportedImagePath,
  splitImagePlatforms,
  SUPPORTED_IMAGE_EXTENSIONS
} from "@/lib/publisher/images";
import {
  DuplicatePostError,
  duplicateQueueMessage,
  findDuplicateInQueue,
  type DuplicateCandidate
} from "@/lib/publisher/duplicates";
import { generateClipMetadata } from "@/lib/publisher/metadata";
import { newPlatformState, publishQueue, type PublishQueue } from "@/lib/publisher/queue";
import { assertBookable } from "@/lib/publisher/schedule";
import { nextBookableSlot } from "@/lib/publisher/slots";
import { finalizeTitle } from "@/lib/title/finalize";
import { resolvePublishAt } from "@/lib/publisher/time";
import { prepareVerticalMedia } from "@/lib/publisher/vertical";
import type { PlatformId, PlatformState, QueueItem, Visibility } from "@/lib/publisher/types";

const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

function manualPlatformState(platform: PlatformId): PlatformState {
  return {
    status: "manual",
    attempts: 0,
    note: `${PLATFORM_LABELS[platform]} isn't connected for this account yet — post this clip by hand at the scheduled time, or connect the account so future posts publish automatically.`
  };
}

/**
 * A picture post that can't publish itself is not a clip waiting to be dragged
 * into an upload box — the slides are already rendered, and the only thing
 * missing is knowing there are eight of them and where. The card links to them;
 * this is what it says.
 */
function manualImagePlatformState(platform: PlatformId, pictures: number): PlatformState {
  const what = pictures > 1 ? `all ${pictures} slides are` : "the picture is";
  return {
    status: "manual",
    attempts: 0,
    note: `${PLATFORM_LABELS[platform]} isn't connected for this account yet — ${what} rendered and ready to post by hand at the scheduled time (open them from this card), or connect the account so future posts publish automatically.`
  };
}

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
  /**
   * The social account (accounts.ts) the post belongs to. Omitted or a
   * platform's primary id → the platform's primary account (today's .env
   * credentials), same as before accounts existed.
   */
  accountId?: string;
  /** Extra context for metadata generation (stream title, topic, spoken text). */
  metadataSource?: { streamTitle?: string; topic?: string; spokenText?: string };
  /**
   * Books a time today. Only a person asking for it, never anything automatic —
   * see `schedule.ts` for why the day a batch is booked is off limits.
   */
  allowSameDay?: boolean;
  /** Queues a post the queue already carries. Only a person asking for it. */
  allowDuplicate?: boolean;
};

/**
 * Resolves the target account. A primary id normalizes back to "no account" so
 * items keep the legacy shape; a non-primary account must exist and can only
 * take posts for its own platform.
 */
async function resolveAccountId(requested: string | undefined, platforms: PlatformId[]): Promise<string | undefined> {
  let accountId = requested;
  if (accountId && isPrimaryAccountId(accountId)) accountId = undefined;
  if (!accountId) return undefined;
  const account = await getAccount(accountId);
  if (!account) throw new Error("That account no longer exists — pick another one in the Uploading Center.");
  if (platforms.some((p) => p !== account.platform)) {
    throw new Error(`Account "${account.label}" is a ${account.platform} account — it cannot take ${platforms.join("/")} posts.`);
  }
  return accountId;
}

/**
 * Platforms without credentials still save — as "manual" reminders — so
 * assigning a post to TikTok/Instagram before those APIs are connected never
 * errors. Configuring credentials is all it takes for the same platforms to
 * publish automatically.
 */
async function configuredPlatformSet(
  platforms: PlatformId[],
  accountId: string | undefined,
  config: ReturnType<typeof publisherConfig>
): Promise<Set<PlatformId>> {
  const configured = new Set<PlatformId>();
  for (const platform of platforms) {
    if (await accountIdConfigured(platform, accountId ?? primaryAccountId(platform), config)) configured.add(platform);
  }
  return configured;
}

/**
 * The two rules every enqueue obeys, checked against the live queue right before
 * the item is added: not today (`schedule.ts`), and not a second copy of
 * something already scheduled (`duplicates.ts`). Both are checked HERE rather
 * than at each call site because there are seven call sites and one of them is
 * an HTTP route that will happily take any instant it is given.
 */
async function assertSchedulable(input: {
  queue: PublishQueue;
  publishAt: Date;
  timeZone: string;
  candidate: DuplicateCandidate;
  allowSameDay?: boolean;
  allowDuplicate?: boolean;
}): Promise<void> {
  assertBookable(input.publishAt, new Date(), input.timeZone, { allowSameDay: input.allowSameDay });
  if (input.allowDuplicate) return;
  const duplicate = findDuplicateInQueue(input.candidate, await input.queue.list());
  if (duplicate) throw new DuplicatePostError(duplicateQueueMessage(duplicate), duplicate.item.id);
}

export async function enqueue(options: EnqueueOptions): Promise<QueueItem> {
  const config = publisherConfig();
  if (!config.enabled) {
    throw new Error(PUBLISHING_OFF_MESSAGE);
  }

  const absolute = path.isAbsolute(options.clipPath) ? options.clipPath : path.join(process.cwd(), options.clipPath);
  await stat(absolute).catch(() => {
    throw new Error(`Clip file not found: ${options.clipPath}`);
  });

  const platforms = (options.platforms?.length ? options.platforms : config.platforms).filter(
    (p, i, list) => list.indexOf(p) === i
  );
  if (platforms.length === 0) throw new Error("No platforms selected (check PUBLISH_PLATFORMS).");

  const accountId = await resolveAccountId(options.accountId, platforms);
  const configured = await configuredPlatformSet(platforms, accountId, config);
  const igAutomated = platforms.includes("instagram") && configured.has("instagram");

  const needsHosting =
    igAutomated ||
    config.queueBackend === "r2" ||
    process.env.TIKTOK_UPLOAD_MODE?.trim().toLowerCase() === "url";
  if (igAutomated && !hostingConfigured(config)) {
    throw new Error(
      "Instagram needs the clip at a public HTTPS URL. Configure S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (Cloudflare R2 free tier) or drop instagram from the platforms."
    );
  }

  const publishAtDate =
    options.publishAt instanceof Date ? options.publishAt : resolvePublishAt(options.publishAt, config.timezone);
  // Checked before the vertical re-render below, which is minutes of ffmpeg: a
  // post that is refused for its time should be refused straight away.
  assertBookable(publishAtDate, new Date(), config.timezone, { allowSameDay: options.allowSameDay });

  // Everything this publisher posts is short-form vertical (Shorts / Reels /
  // TikTok). A landscape source is re-rendered vertical here — before hosting
  // and before the queue records the path — because YouTube classifies Shorts
  // purely by the file's aspect ratio and duration; a landscape upload would
  // land as a long-form video.
  const prepared = await prepareVerticalMedia(absolute, platforms);
  if (prepared.converted) {
    console.log(`[publisher] ${path.basename(absolute)} is landscape — posting the 9:16 render ${path.basename(prepared.path)}`);
  }

  // Both the file that will be posted and the one it was rendered from, so a
  // landscape master and its vertical render are one post, not two.
  await assertSchedulable({
    queue: publishQueue(config),
    publishAt: publishAtDate,
    timeZone: config.timezone,
    candidate: { paths: [prepared.path, absolute], jobId: options.jobId, title: options.title },
    allowSameDay: options.allowSameDay,
    allowDuplicate: options.allowDuplicate
  });

  let { title, caption, hashtags } = options;
  if (!title || !caption || !hashtags?.length) {
    const generated = await generateClipMetadata(options.metadataSource ?? { streamTitle: path.basename(absolute) });
    title ??= generated.title;
    caption ??= generated.description;
    hashtags = hashtags?.length ? hashtags : generated.hashtags;
  }

  const id = crypto.randomUUID().slice(0, 8);

  // Shared post-processing: optionally inject one category-aware emoji and log
  // the title for later CTR analysis. Both the short-form (here) and long-form
  // pipelines run the same finalizeTitle step, so emoji behaviour stays
  // consistent. With emoji disabled this returns the title unchanged.
  const finalized = await finalizeTitle({
    baseTitle: title,
    category: options.metadataSource?.topic,
    pipelineType: "short",
    videoId: id
  });
  title = finalized.title;
  const item: QueueItem = {
    id,
    clipPath: path.relative(process.cwd(), prepared.path),
    ...(prepared.converted ? { sourceClipPath: path.relative(process.cwd(), absolute) } : {}),
    title,
    caption,
    hashtags,
    publishAt: publishAtDate.toISOString(),
    visibility: options.visibility ?? config.defaultVisibility,
    createdAt: new Date().toISOString(),
    jobId: options.jobId,
    ...(accountId ? { accountId } : {}),
    platforms: Object.fromEntries(
      platforms.map((p) => [p, configured.has(p) ? newPlatformState() : manualPlatformState(p)])
    )
  };

  if (needsHosting && hostingConfigured(config)) {
    const hosted = await hostMedia(prepared.path, id);
    item.mediaKey = hosted.key;
  }

  await publishQueue(config).add(item);
  return item;
}

export type EnqueueImageOptions = {
  /** Absolute or repo-relative image files, in the order they should appear. */
  imagePaths: string[];
  /** "YYYY-MM-DDTHH:mm" in PUBLISH_TIMEZONE, or full ISO-8601 with offset. */
  publishAt: string | Date;
  caption?: string;
  title?: string;
  hashtags?: string[];
  /** Defaults to the image-capable platforms among PUBLISH_PLATFORMS. */
  platforms?: PlatformId[];
  visibility?: Visibility;
  jobId?: string;
  accountId?: string;
  metadataSource?: { streamTitle?: string; topic?: string; spokenText?: string };
  /** See EnqueueOptions — a person's override, never anything automatic. */
  allowSameDay?: boolean;
  allowDuplicate?: boolean;
};

/**
 * enqueueImagePost(image_paths, caption, publish_at, platforms) — the picture
 * twin of enqueue(). One image posts as a single picture; several post as an
 * ordered carousel. Nothing is sent here: the item lands at its slot for the
 * publish runner, exactly like a video.
 *
 * Platforms that cannot carry a picture post are refused NOW, with the reason,
 * rather than queued to fail at their slot.
 */
export async function enqueueImagePost(options: EnqueueImageOptions): Promise<QueueItem> {
  const config = publisherConfig();
  if (!config.enabled) {
    throw new Error(PUBLISHING_OFF_MESSAGE);
  }

  const requested = options.imagePaths.filter((entry) => entry.trim().length > 0);
  if (requested.length === 0) throw new Error("An image post needs at least one picture.");
  if (requested.length > MAX_IMAGES_PER_POST) {
    throw new Error(
      `An image post can carry at most ${MAX_IMAGES_PER_POST} pictures — this one has ${requested.length}. Split the deck.`
    );
  }

  const absolutePaths = requested.map((entry) => (path.isAbsolute(entry) ? entry : path.join(process.cwd(), entry)));
  for (const absolute of absolutePaths) {
    if (!isSupportedImagePath(absolute)) {
      throw new Error(
        `${path.basename(absolute)} is not a supported picture (${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}).`
      );
    }
    await stat(absolute).catch(() => {
      throw new Error(`Image file not found: ${absolute}`);
    });
  }

  const asked = (options.platforms?.length ? options.platforms : config.platforms).filter(
    (p, i, list) => list.indexOf(p) === i
  );
  if (asked.length === 0) throw new Error("No platforms selected (check PUBLISH_PLATFORMS).");

  const { supported, refused } = splitImagePlatforms(asked);
  // An explicit ask for a platform that cannot do this is an error, not a
  // silent drop; falling back to PUBLISH_PLATFORMS just filters.
  if (options.platforms?.length && refused.length > 0) {
    throw new Error(refused.map((entry) => entry.reason).join(" "));
  }
  if (supported.length === 0) {
    throw new Error(
      `None of the switched-on platforms can post pictures. ${refused.map((entry) => entry.reason).join(" ")}`.trim()
    );
  }

  const accountId = await resolveAccountId(options.accountId, supported);
  const configured = await configuredPlatformSet(supported, accountId, config);

  // Both picture platforms pull the file from a public HTTPS URL, so an
  // automated image post cannot exist without hosting. Say so now.
  const needsHosting = configured.size > 0 || config.queueBackend === "r2";
  if (configured.size > 0 && !hostingConfigured(config)) {
    throw new Error(
      "Instagram and Facebook download pictures from a public HTTPS URL. Configure S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (Cloudflare R2 free tier) before scheduling picture posts."
    );
  }

  const publishAtDate =
    options.publishAt instanceof Date ? options.publishAt : resolvePublishAt(options.publishAt, config.timezone);
  await assertSchedulable({
    queue: publishQueue(config),
    publishAt: publishAtDate,
    timeZone: config.timezone,
    candidate: { paths: absolutePaths, jobId: options.jobId, title: options.title },
    allowSameDay: options.allowSameDay,
    allowDuplicate: options.allowDuplicate
  });

  let { title, caption, hashtags } = options;
  if (!title || !caption || !hashtags?.length) {
    const generated = await generateClipMetadata(
      options.metadataSource ?? { streamTitle: path.basename(absolutePaths[0]) }
    );
    title ??= generated.title;
    caption ??= generated.description;
    hashtags = hashtags?.length ? hashtags : generated.hashtags;
  }

  const id = crypto.randomUUID().slice(0, 8);
  const relativePaths = absolutePaths.map((absolute) => path.relative(process.cwd(), absolute));

  const item: QueueItem = {
    id,
    mediaKind: "image",
    imagePaths: relativePaths,
    // The first picture also fills clipPath, so the pipeline's "already
    // scheduled" check and the calendar keep seeing this post (see images.ts).
    clipPath: relativePaths[0],
    title,
    caption,
    hashtags,
    publishAt: publishAtDate.toISOString(),
    visibility: options.visibility ?? config.defaultVisibility,
    createdAt: new Date().toISOString(),
    jobId: options.jobId,
    ...(accountId ? { accountId } : {}),
    platforms: Object.fromEntries(
      supported.map((p) => [
        p,
        configured.has(p) ? newPlatformState() : manualImagePlatformState(p, relativePaths.length)
      ])
    )
  };

  if (needsHosting && hostingConfigured(config)) {
    item.imageKeys = await hostImages(absolutePaths, id);
    item.mediaKey = item.imageKeys[0];
  }

  await publishQueue(config).add(item);
  return item;
}

/**
 * Opt-in hook called by the clip export pipeline when an export finishes.
 * Does nothing unless PUBLISH_ENABLED and PUBLISH_AUTO_ENQUEUE are both true,
 * and never throws (a publishing hiccup must not fail the export).
 *
 * It used to schedule the post PUBLISH_AUTO_ENQUEUE_DELAY_MINUTES from now,
 * which is the same day — so every export of a batch queued itself for this
 * afternoon. It takes the first bookable slot instead (tomorrow's earliest,
 * free or not: `enqueue` refuses the duplicate, not the collision, and the
 * Uploading Center is where a slot clash is resolved).
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
      publishAt: new Date(nextBookableSlot({ timeZone: config.timezone }).utc),
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
