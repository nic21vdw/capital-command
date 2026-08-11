import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeChannelSchedule } from "@/lib/publisher/channelVideos";
import type { PublisherConfig } from "@/lib/publisher/config";
import { findDuplicateOnChannel } from "@/lib/publisher/duplicates";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * The last check before bytes go to YouTube: is this video already on the
 * channel?
 *
 * The queue-side check in `enqueue()` catches everything the app still
 * remembers, but a published post can be swept off the board (a fully-failed
 * item is purged after 30 days, and a person can delete any of them), and the
 * clip file it named can be re-rendered under a new path. The channel itself is
 * the only record that cannot go stale, so it is what the upload asks last.
 *
 * It fails OPEN. A channel read that 403s (a token minted before the readonly
 * scope), times out, or comes back empty must never stop a legitimate post —
 * the guard is a second pair of eyes, not the gate.
 */
export async function youtubeChannelDuplicate(
  item: QueueItem,
  config: PublisherConfig,
  now = new Date()
): Promise<{ videoId: string; title: string; url: string } | null> {
  if (!config.youtube.duplicateGuard) return null;
  try {
    const schedule = await youtubeChannelSchedule({
      accountId: item.accountId ?? primaryAccountId("youtube"),
      now
    });
    if (!schedule.configured || schedule.needsReconnect || schedule.error) return null;
    const match = findDuplicateOnChannel(item.title, schedule.videos, now);
    return match ? { videoId: match.videoId, title: match.title, url: match.url } : null;
  } catch {
    return null;
  }
}

export function channelDuplicateMessage(match: { title: string; url: string }): string {
  return (
    `"${match.title}" is already on the channel (${match.url}) — this upload was stopped rather than posting it ` +
    `a second time. Retitle the post, or delete it if the video is already up.`
  );
}
