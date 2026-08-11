import path from "node:path";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * NOTHING GOES OUT TWICE.
 *
 * A batch of shorts once landed on the channel several times over: the same
 * clips, re-planned and re-booked, uploaded within minutes of each other. The
 * pipeline's booking sheet deduped by file path against the live queue, but that
 * was the ONLY check in the app — every other route into the queue (the
 * Uploading Center, the editor's Schedule Short menu, the CLI, the API, the
 * export auto-enqueue) could add the same clip again, and a queue item that had
 * been deleted after publishing took its file path with it.
 *
 * So the check moved down to `enqueue()`, the one door every route goes through,
 * and it asks two questions of what is already queued:
 *
 *   - are these the same BYTES? (the file, its pre-vertical original, its
 *     hosted copy, every picture of a deck)
 *   - is this the same CLIP, retitled? (same job, same normalized title)
 *
 * and one of the channel itself, before the upload: is this video already up
 * there? That last one is the backstop for the case the queue cannot see —
 * a post whose queue item is long gone.
 *
 * Everything here is pure. `duplicateGuard.ts` does the reading.
 */

/** Case, punctuation, emoji and spacing differences are not different titles. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\p{M}\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Absolute, lower-cased, so two spellings of one file compare equal. */
function resolveKey(filePath: string): string {
  return path.resolve(process.cwd(), filePath).toLowerCase();
}

/** Every file a queue item claims: the post's media, its original, its pictures. */
export function itemMediaKeys(item: QueueItem): string[] {
  const keys: string[] = [];
  for (const value of [item.clipPath, item.sourceClipPath, ...(item.imagePaths ?? [])]) {
    if (value) keys.push(resolveKey(value));
  }
  return keys;
}

export type DuplicateCandidate = {
  /** Every file this post would carry, absolute or repo-relative. */
  paths: string[];
  /** The clip job it came from, when it came from one. */
  jobId?: string;
  title?: string;
};

export type QueueDuplicate = {
  item: QueueItem;
  reason: "same-file" | "same-title";
};

/**
 * The queue item that already carries this post, if there is one. A FAILED post
 * is not a duplicate — nothing reached a platform, and re-scheduling it is
 * exactly what a person does next.
 */
export function findDuplicateInQueue(candidate: DuplicateCandidate, items: QueueItem[]): QueueDuplicate | undefined {
  const wanted = new Set(candidate.paths.map(resolveKey));
  const title = candidate.title ? normalizeTitle(candidate.title) : "";

  for (const item of items) {
    if (Object.values(item.platforms).every((state) => state?.status === "failed")) continue;
    if (itemMediaKeys(item).some((key) => wanted.has(key))) return { item, reason: "same-file" };
    if (
      title &&
      candidate.jobId &&
      item.jobId === candidate.jobId &&
      item.title &&
      normalizeTitle(item.title) === title
    ) {
      return { item, reason: "same-title" };
    }
  }
  return undefined;
}

/** Thrown by `enqueue()` rather than adding a second copy of a post. */
export class DuplicatePostError extends Error {
  constructor(
    message: string,
    readonly existingItemId: string
  ) {
    super(message);
    this.name = "DuplicatePostError";
  }
}

export function duplicateQueueMessage(duplicate: QueueDuplicate): string {
  const { item, reason } = duplicate;
  const what = reason === "same-file" ? "That exact file" : `A post from the same clip titled "${item.title}"`;
  return (
    `${what} is already scheduled for ${item.publishAt} (post ${item.id}) — ` +
    `it was not scheduled a second time. Remove that post first if you want to re-book it.`
  );
}

/**
 * Videos on the channel that share a title, newest group first — the audit
 * behind "did the app post the same short twice?". It answers about what is
 * REALLY on YouTube, including videos this app never queued, because that is the
 * only record a deleted queue item cannot make lie.
 */
export type ChannelDuplicateGroup = { title: string; videos: ChannelVideo[] };

export function channelDuplicateGroups(videos: ChannelVideo[]): ChannelDuplicateGroup[] {
  const byTitle = new Map<string, ChannelVideo[]>();
  for (const video of videos) {
    const key = normalizeTitle(video.title);
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), video]);
  }
  return [...byTitle.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      title: group[0].title,
      videos: [...group].sort((a, b) => b.publishAtUtc.localeCompare(a.publishAtUtc))
    }))
    .sort((a, b) => b.videos[0].publishAtUtc.localeCompare(a.videos[0].publishAtUtc));
}

/**
 * Posts on the QUEUE that would repeat each other — the same file booked twice,
 * or one clip queued under two titles that normalize to the same words. Caught
 * before anything uploads, which is the cheap half of the audit.
 */
export type QueueDuplicateGroup = { reason: "same-file" | "same-title"; items: QueueItem[] };

export function queueDuplicateGroups(items: QueueItem[]): QueueDuplicateGroup[] {
  const live = items.filter((item) => !Object.values(item.platforms).every((state) => state?.status === "failed"));
  const byFile = new Map<string, QueueItem[]>();
  const byTitle = new Map<string, QueueItem[]>();
  for (const item of live) {
    for (const key of new Set(itemMediaKeys(item))) byFile.set(key, [...(byFile.get(key) ?? []), item]);
    const title = normalizeTitle(item.title ?? "");
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), item]);
  }
  const groups: QueueDuplicateGroup[] = [];
  const seen = new Set<string>();
  for (const group of byFile.values()) {
    if (group.length < 2) continue;
    const key = group.map((item) => item.id).sort().join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ reason: "same-file", items: group });
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const key = group.map((item) => item.id).sort().join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ reason: "same-title", items: group });
  }
  return groups;
}

/** How far back a channel video still counts as "this is already up". */
export const CHANNEL_DUPLICATE_WINDOW_DAYS = 30;

/**
 * The video already on the channel that this post would repeat. Titles are what
 * there is to compare — the channel API says nothing about which local file a
 * video came from — so this is deliberately an EXACT match after normalizing,
 * never a similarity score: refusing to post something that merely resembles an
 * older video would be a worse failure than the duplicate it prevents.
 */
export function findDuplicateOnChannel(
  title: string,
  videos: ChannelVideo[],
  now: Date,
  windowDays = CHANNEL_DUPLICATE_WINDOW_DAYS
): ChannelVideo | undefined {
  const wanted = normalizeTitle(title);
  if (!wanted) return undefined;
  const cutoff = now.getTime() - windowDays * 86_400_000;
  return videos.find(
    (video) => normalizeTitle(video.title) === wanted && new Date(video.publishAtUtc).getTime() >= cutoff
  );
}
