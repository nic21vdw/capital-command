import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeChannelSchedule, type ChannelVideo } from "@/lib/publisher/channelVideos";
import { publishQueue } from "@/lib/publisher/queue";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Videos that are on the channel with nothing in the queue pointing at them.
 *
 * `reconcileYoutube` answers a narrower question — which queue item does this
 * video belong to — and can only speak for items that tried to upload and lost
 * their id. A video the queue has NO record of at all falls through it: it stays
 * an orphan, invisible to the runner, uncounted by the schedule, and free to
 * collide with a slot the app then books on top of it. Thirteen of them had
 * accumulated on the channel before anything noticed.
 *
 * Adopting one writes a queue item that records what YouTube already holds. It
 * is deliberately a RECORD, not a job:
 *
 *   - the item carries the video id, so the runner's resume branch takes it and
 *     no bytes are ever sent (a `postId` means the post exists, whatever the
 *     status says);
 *   - only YouTube is listed, so no other platform picks it up;
 *   - it has no clip file, because there is no local file to point at — the
 *     dedupe reads skip an empty path rather than matching every other one.
 *
 * The id is derived from the video id, so adopting twice updates one record
 * instead of writing a second.
 */

export type AdoptReport = {
  configured: boolean;
  needsReconnect: boolean;
  /** On-channel videos the queue has no record of. */
  unknown: ChannelVideo[];
  adopted: QueueItem[];
  applied: boolean;
  error: string | null;
};

export function adoptedItemId(videoId: string): string {
  return `youtube-${videoId}`;
}

export function unknownChannelVideos(videos: ChannelVideo[], items: QueueItem[]): ChannelVideo[] {
  const claimed = new Set(
    items.map((item) => item.platforms.youtube?.postId).filter((id): id is string => Boolean(id))
  );
  return videos.filter((video) => !claimed.has(video.videoId));
}

export function adoptedItem(video: ChannelVideo, now: Date, accountId?: string): QueueItem {
  return {
    id: adoptedItemId(video.videoId),
    clipPath: "",
    title: video.title,
    caption: "",
    hashtags: [],
    publishAt: video.publishAtUtc,
    visibility: "public",
    createdAt: now.toISOString(),
    accountId,
    platforms: {
      youtube: {
        status: video.status === "published" ? "published" : "scheduled",
        postId: video.videoId,
        attempts: 0,
        uploadedAt: video.publishAtUtc,
        ...(video.status === "published" ? { publishedAt: video.publishAtUtc } : {}),
        note: "Found on the channel with no queue record — adopted so the schedule can see it."
      }
    }
  };
}

export async function adoptChannelVideos(
  options: { apply?: boolean; now?: Date; accountId?: string } = {}
): Promise<AdoptReport> {
  const now = options.now ?? new Date();
  const accountId = options.accountId ?? primaryAccountId("youtube");
  const schedule = await youtubeChannelSchedule({ force: true, now, accountId });
  if (!schedule.configured || schedule.needsReconnect || schedule.error) {
    return {
      configured: schedule.configured,
      needsReconnect: schedule.needsReconnect,
      unknown: [],
      adopted: [],
      applied: false,
      error: schedule.error
    };
  }

  const queue = publishQueue();
  const unknown = unknownChannelVideos(schedule.videos, await queue.list());
  const adopted = unknown.map((video) => adoptedItem(video, now, accountId));
  if (options.apply) {
    for (const item of adopted) await queue.add(item, "adopt-channel-videos");
  }

  return {
    configured: true,
    needsReconnect: false,
    unknown,
    adopted: options.apply ? adopted : [],
    applied: Boolean(options.apply),
    error: null
  };
}
