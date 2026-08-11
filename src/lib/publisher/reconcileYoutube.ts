import { scanChannelUploads } from "@/lib/ingest/channelScan";
import { publishQueue } from "@/lib/publisher/queue";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Finds videos this app uploaded but never recorded.
 *
 * Before uploads were idempotent, a network error after the bytes landed left
 * the item with no postId, so the next tick uploaded the same clip again. Each
 * lost attempt is still a real public video on the channel with no queue item
 * pointing at it — invisible to the app, and not counted by the quota meter.
 *
 * Matching is by exact title against videos the queue does not already claim.
 * That is good enough to surface them and deliberately not good enough to
 * trust blindly: several attempts at one clip share a title, so anything
 * ambiguous is reported rather than assigned, and the caller decides.
 */

export type OrphanVideo = {
  videoId: string;
  title: string;
  publishedAt: string;
  url: string;
  privacyStatus: string;
};

export type ReconcileMatch = {
  itemId: string;
  clipPath: string;
  title: string;
  videoId: string;
  url: string;
};

export type ReconcileReport = {
  configured: boolean;
  /** Queue items that were retried, produced a video, but recorded no id. */
  matched: ReconcileMatch[];
  /** On-channel videos no queue item accounts for. */
  orphans: OrphanVideo[];
  /** Titles where more than one video or item competes — never auto-assigned. */
  ambiguous: Array<{ title: string; videoIds: string[]; itemIds: string[] }>;
  applied: boolean;
};

/** Items whose YouTube attempt never recorded an id but did try to upload. */
function unrecordedItems(items: QueueItem[]): QueueItem[] {
  return items.filter((item) => {
    const state = item.platforms.youtube;
    return Boolean(state) && !state!.postId && (state!.attempts ?? 0) > 0;
  });
}

export async function reconcileYoutube(
  options: { apply?: boolean; lookbackDays?: number; now?: Date } = {}
): Promise<ReconcileReport> {
  const now = options.now ?? new Date();
  const scan = await scanChannelUploads({ now, lookbackDays: options.lookbackDays ?? 30 });
  if (!scan.configured) {
    return { configured: false, matched: [], orphans: [], ambiguous: [], applied: false };
  }

  const queue = publishQueue();
  const items = await queue.list();
  const claimed = new Set(
    items.map((item) => item.platforms.youtube?.postId).filter((id): id is string => Boolean(id))
  );

  const unclaimed = scan.uploads.filter((upload) => !claimed.has(upload.videoId));
  const candidates = unrecordedItems(items);

  const byTitle = new Map<string, typeof unclaimed>();
  for (const upload of unclaimed) {
    const key = upload.title.trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), upload]);
  }
  const itemsByTitle = new Map<string, QueueItem[]>();
  for (const item of candidates) {
    const key = item.title.trim().toLowerCase();
    itemsByTitle.set(key, [...(itemsByTitle.get(key) ?? []), item]);
  }

  const matched: ReconcileMatch[] = [];
  const ambiguous: ReconcileReport["ambiguous"] = [];
  const assigned = new Set<string>();

  for (const [key, group] of itemsByTitle) {
    const videos = byTitle.get(key) ?? [];
    if (videos.length === 0) continue;
    if (group.length !== 1 || videos.length !== 1) {
      ambiguous.push({
        title: group[0]!.title,
        videoIds: videos.map((v) => v.videoId),
        itemIds: group.map((i) => i.id)
      });
      continue;
    }
    const item = group[0]!;
    const video = videos[0]!;
    matched.push({ itemId: item.id, clipPath: item.clipPath, title: item.title, videoId: video.videoId, url: video.url });
    assigned.add(video.videoId);
    if (options.apply) {
      const state = item.platforms.youtube!;
      state.postId = video.videoId;
      state.status = video.privacyStatus === "public" ? "published" : "scheduled";
      state.error = undefined;
      state.nextAttemptAt = undefined;
      state.claimedAt = undefined;
      state.uploadedAt ??= video.publishedAt;
      if (video.privacyStatus === "public") state.publishedAt ??= video.publishedAt;
    }
  }

  if (options.apply && matched.length > 0) await queue.save();

  const orphans: OrphanVideo[] = unclaimed
    .filter((upload) => !assigned.has(upload.videoId))
    .map((upload) => ({
      videoId: upload.videoId,
      title: upload.title,
      publishedAt: upload.publishedAt,
      url: upload.url,
      privacyStatus: upload.privacyStatus
    }));

  return { configured: true, matched, orphans, ambiguous, applied: Boolean(options.apply) };
}
