import { cursorKey, type PostCursor, type PublishedPost } from "@/lib/inbox/types";

export const POST_WINDOW_DAYS = 30;
export const ACTIVITY_WINDOW_DAYS = 7;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const TIERS: Array<{ belowHours: number; minutes: number }> = [
  { belowHours: 6, minutes: 25 },
  { belowHours: 48, minutes: 120 },
  { belowHours: 168, minutes: 720 },
  { belowHours: Infinity, minutes: 1440 }
];

export function pollIntervalMinutes(effectiveAgeHours: number): number {
  return (TIERS.find((tier) => effectiveAgeHours < tier.belowHours) ?? TIERS[TIERS.length - 1]).minutes;
}

function hoursSince(iso: string | undefined, now: Date): number {
  return iso ? (now.getTime() - Date.parse(iso)) / HOUR_MS : Infinity;
}

function inScope(post: PublishedPost, cursor: PostCursor | undefined, now: Date): boolean {
  const publishedMs = Date.parse(post.publishedAt);
  if (!Number.isFinite(publishedMs) || publishedMs > now.getTime()) return false;
  if (now.getTime() - publishedMs <= POST_WINDOW_DAYS * DAY_MS) return true;
  return hoursSince(cursor?.lastActivityAt, now) <= (ACTIVITY_WINDOW_DAYS * DAY_MS) / HOUR_MS;
}

function isDue(post: PublishedPost, cursor: PostCursor | undefined, now: Date): boolean {
  if (!cursor?.lastFetchedAt) return true;
  const effectiveAge = Math.min(hoursSince(post.publishedAt, now), hoursSince(cursor.lastActivityAt, now));
  return hoursSince(cursor.lastFetchedAt, now) * 60 >= pollIntervalMinutes(effectiveAge);
}

export function selectPostsToFetch(
  posts: PublishedPost[],
  cursors: Record<string, PostCursor>,
  now: Date,
  options: { limit: number; force?: boolean }
): PublishedPost[] {
  const due = posts.filter((post) => {
    const cursor = cursors[cursorKey(post.platform, post.postId)];
    return inScope(post, cursor, now) && (options.force || isDue(post, cursor, now));
  });
  const fetchedAt = (post: PublishedPost) => {
    const stamp = cursors[cursorKey(post.platform, post.postId)]?.lastFetchedAt;
    return stamp ? Date.parse(stamp) : -Infinity;
  };
  return due
    .sort((a, b) => fetchedAt(a) - fetchedAt(b) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, options.limit);
}
