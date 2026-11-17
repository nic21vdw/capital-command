import type { RunBacklog } from "@/lib/pipeline/shortsBacklog";
import type { LegHeld } from "@/lib/publisher/approval";
import { countInboxDrafts, deliversViaInbox } from "@/lib/publisher/tiktokInbox";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

// How far ahead the Shorts are actually booked, and what is stopping more.
//
// The publisher card only ever counted failures, so three things that each
// stopped posts for weeks read as a green "completed": the queue running dry
// while finished clips sat unbooked, and TikTok refusing new uploads because
// its inbox held more unfinished drafts than TIKTOK_INBOX_LIMIT. Pure: the
// overview feeds it the queue, the backlog, the relay switch and the review
// policy.

export const RUNWAY_DAYS = 7;
/** Below this share of the cadence's slots booked over the window, say so. */
export const RUNWAY_WARN_SHARE = 0.5;

const DAY_MS = 86_400_000;

export type PlatformRunway = { platform: PlatformId; booked: number; held: number; expected: number };

function isShort(item: QueueItem): boolean {
  return item.mediaKind !== "image" && item.format !== "long";
}

/**
 * Will this leg reach its platform without anyone doing anything?
 *
 *   pending, uploaded   the runner sends it at its slot
 *   scheduled           the platform holds it and publishes at the slot
 *                       (YouTube, Facebook natively, TikTok through a relay)
 *                       EXCEPT a TikTok inbox draft: it sits on the phone until
 *                       someone posts it, so it is not booked in any sense
 *                       that ends with a post
 *   published, future   only YouTube: an upload made ahead and kept private
 *                       until its publishAt. No other adapter marks a leg
 *                       published before its slot.
 */
export function legWillPost(item: QueueItem, platform: PlatformId, leg: PlatformState, now: number, relayOn: boolean): boolean {
  const at = Date.parse(item.publishAt);
  if (leg.status === "pending" || leg.status === "uploaded") return true;
  if (leg.status === "scheduled") return !(platform === "tiktok" && deliversViaInbox(item, relayOn));
  if (leg.status === "published") return platform === "youtube" && at > now;
  return false;
}

export function shortsRunway(
  queue: QueueItem[],
  platforms: PlatformId[],
  shortsPerDay: number,
  now: Date,
  options: { relayOn?: boolean; held?: LegHeld; days?: number } = {}
): PlatformRunway[] {
  const days = options.days ?? RUNWAY_DAYS;
  const start = now.getTime();
  const end = start + days * DAY_MS;
  const expected = Math.max(0, Math.round(shortsPerDay * days));
  return platforms.map((platform) => {
    let booked = 0;
    let held = 0;
    for (const item of queue) {
      if (!isShort(item)) continue;
      const leg = item.platforms[platform];
      const at = Date.parse(item.publishAt);
      if (!leg || !Number.isFinite(at) || at <= start || at > end) continue;
      if (!legWillPost(item, platform, leg, start, options.relayOn ?? false)) continue;
      if (options.held?.(platform, leg)) held += 1;
      else booked += 1;
    }
    return { platform, booked, held, expected };
  });
}

export type TiktokInboxWall = { drafts: number; limit: number; stuck: number; oldestAt: string | null };

/**
 * The runner's own rule (`usesTiktokInbox`, `outstandingTiktokDrafts`): only
 * inbox-delivered legs fill the inbox, and only they are deferred when it is
 * full. A direct post or a relay is not behind the wall.
 */
export function tiktokInboxWall(queue: QueueItem[], limit: number, relayOn: boolean): TiktokInboxWall | null {
  if (relayOn) return null;
  const drafts = countInboxDrafts(queue, relayOn);
  let stuck = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const item of queue) {
    if (item.platforms.tiktok?.status !== "pending" || !deliversViaInbox(item, relayOn)) continue;
    stuck += 1;
    const at = Date.parse(item.publishAt);
    if (Number.isFinite(at)) oldest = Math.min(oldest, at);
  }
  if (drafts < limit || stuck === 0) return null;
  return { drafts, limit, stuck, oldestAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null };
}

/** "Day 98" out of the series title, otherwise the name cut on a word to fit a card line. */
export function shortStreamName(name: string): string {
  const day = name.match(/\bDay\s*\d+(?:\.\d+)?/i);
  if (day) return day[0].replace(/\s+/, " ");
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= 32) return clean;
  const cut = clean.slice(0, 32);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : 32).trimEnd()}...`;
}

const LABEL: Record<string, string> = {
  youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn"
};

function dateLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}

export type RunwayInput = {
  queue: QueueItem[];
  backlog: RunBacklog[];
  platforms: PlatformId[];
  shortsPerDay: number;
  timezone: string;
  tiktokInboxLimit: number;
  tiktokRelayOn: boolean;
  held?: LegHeld;
};

/** The publisher card's lines about supply, most blocking first. */
export function runwayIssues(input: RunwayInput, now: Date): string[] {
  const issues: string[] = [];
  const wall = input.platforms.includes("tiktok") ? tiktokInboxWall(input.queue, input.tiktokInboxLimit, input.tiktokRelayOn) : null;
  if (wall) {
    const since = wall.oldestAt ? `, the oldest since ${dateLabel(wall.oldestAt, input.timezone)}` : "";
    issues.push(
      `TikTok is holding too many unfinished drafts (${wall.drafts} of ${wall.limit}), so ${wall.stuck} TikTok posts are stuck${since}. Post or discard the drafts in the TikTok app; nothing new reaches TikTok until then.`
    );
  }
  const thin = shortsRunway(input.queue, input.platforms, input.shortsPerDay, now, { relayOn: input.tiktokRelayOn, held: input.held })
    .filter((entry) => entry.expected > 0 && entry.booked + entry.held < entry.expected * RUNWAY_WARN_SHARE)
    .filter((entry) => !(wall && entry.platform === "tiktok"));
  if (thin.length) {
    const parts = thin.map(
      (entry) => `${LABEL[entry.platform] ?? entry.platform} ${entry.booked} of ${entry.expected}${entry.held ? ` (+${entry.held} waiting for your approval)` : ""}`
    );
    issues.push(`Shorts booked for the next ${RUNWAY_DAYS} days: ${parts.join(", ")}. The schedule is running dry.`);
  }
  const waiting = input.backlog.filter((run) => run.waiting.length > 0);
  if (waiting.length) {
    const total = waiting.reduce((sum, run) => sum + run.waiting.length, 0);
    const names = waiting.map((run) => `${shortStreamName(run.runName)} (${run.waiting.length})`);
    const listed = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
    issues.push(
      `${total} finished Short${total === 1 ? " is" : "s are"} not booked yet, from ${waiting.length} recent stream${waiting.length === 1 ? "" : "s"}: ${listed}. Review them on Weekly Shorts Review.`
    );
  }
  return issues;
}
