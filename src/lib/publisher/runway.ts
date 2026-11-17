import type { PipelineRun } from "@/lib/pipeline/types";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

// How far ahead the Shorts are actually booked, and what is stopping more.
//
// The publisher card only ever counted failures, so three things that each
// stopped posts for weeks read as a green "completed":
//   - the queue running dry (32 future items in November, 1 on YouTube) while
//     streams that had already made their clips sat unbooked,
//   - TikTok refusing new uploads because its inbox held more unfinished drafts
//     than TIKTOK_INBOX_LIMIT, which deferred every TikTok leg on every tick,
//   - and neither being said anywhere a person looks.
// Pure, no store imports: the overview feeds it the queue, runs and config.

export const RUNWAY_DAYS = 7;
/** Below this share of the cadence's slots booked over the window, say so. */
export const RUNWAY_WARN_SHARE = 0.5;
/** A run older than this is history, not a stream waiting to be booked. */
export const UNBOOKED_LOOKBACK_DAYS = 21;

const DAY_MS = 86_400_000;
const WAITING = new Set(["pending", "uploaded", "scheduled"]);

export type PlatformRunway = { platform: PlatformId; booked: number; expected: number };

function isShort(item: QueueItem): boolean {
  return item.mediaKind !== "image" && item.format !== "long";
}

/** A leg that will still go out: waiting, or a YouTube upload scheduled privately for later. */
function willPost(status: string, publishAt: number, now: number): boolean {
  if (WAITING.has(status)) return true;
  return status === "published" && publishAt > now;
}

export function shortsRunway(
  queue: QueueItem[],
  platforms: PlatformId[],
  shortsPerDay: number,
  now: Date,
  days = RUNWAY_DAYS
): PlatformRunway[] {
  const start = now.getTime();
  const end = start + days * DAY_MS;
  const expected = Math.max(0, Math.round(shortsPerDay * days));
  return platforms.map((platform) => {
    let booked = 0;
    for (const item of queue) {
      if (!isShort(item)) continue;
      const leg = item.platforms[platform];
      const at = Date.parse(item.publishAt);
      if (!leg || !Number.isFinite(at) || at <= start || at > end) continue;
      if (willPost(leg.status, at, start)) booked += 1;
    }
    return { platform, booked, expected };
  });
}

export type TiktokInboxWall = { drafts: number; limit: number; stuck: number; oldestAt: string | null };

/**
 * TikTok's inbox flow: each upload is an unfinished draft until it is posted
 * from the phone, and past the limit the runner defers every TikTok leg. Null
 * when the inbox has room, or when TikTok posts through a relay instead.
 */
export function tiktokInboxWall(queue: QueueItem[], limit: number, viaInbox: boolean): TiktokInboxWall | null {
  if (!viaInbox) return null;
  let drafts = 0;
  let stuck = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const item of queue) {
    const leg = item.platforms.tiktok;
    if (!leg) continue;
    if (leg.status === "scheduled") drafts += 1;
    if (leg.status === "pending") {
      stuck += 1;
      const at = Date.parse(item.publishAt);
      if (Number.isFinite(at)) oldest = Math.min(oldest, at);
    }
  }
  if (drafts < limit || stuck === 0) return null;
  return { drafts, limit, stuck, oldestAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null };
}

export type UnbookedStream = { runId: string; name: string; createdAt: string };

/** Recent streams that made their clips and have nothing in the publish queue. */
export function unbookedStreams(runs: PipelineRun[], queue: QueueItem[], now: Date, lookbackDays = UNBOOKED_LOOKBACK_DAYS): UnbookedStream[] {
  const booked = new Set(queue.map((item) => item.runId).filter((id): id is string => Boolean(id)));
  const since = now.getTime() - lookbackDays * DAY_MS;
  return runs
    .filter((run) => run.clipJobId && run.status !== "error" && !run.failures?.clips)
    .filter((run) => Date.parse(run.createdAt) >= since && !booked.has(run.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((run) => ({ runId: run.id, name: run.name, createdAt: run.createdAt }));
}

/** "Day 98" out of the series title, otherwise the name cut to fit a card line. */
export function shortStreamName(name: string): string {
  const day = name.match(/\bDay\s*\d+(?:\.\d+)?/i);
  if (day) return day[0].replace(/\s+/, " ");
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= 32) return clean;
  const cut = clean.slice(0, 32);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 32).trimEnd()}...`;
}

const LABEL: Record<string, string> = {
  youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn"
};

function dateLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}

export type RunwayInput = {
  queue: QueueItem[];
  runs: PipelineRun[];
  platforms: PlatformId[];
  shortsPerDay: number;
  timezone: string;
  tiktokInboxLimit: number;
  tiktokViaInbox: boolean;
};

/** The publisher card's lines about supply, most blocking first. */
export function runwayIssues(input: RunwayInput, now: Date): string[] {
  const issues: string[] = [];
  const wall = tiktokInboxWall(input.queue, input.tiktokInboxLimit, input.tiktokViaInbox && input.platforms.includes("tiktok"));
  if (wall) {
    const since = wall.oldestAt ? `, the oldest since ${dateLabel(wall.oldestAt, input.timezone)}` : "";
    issues.push(
      `TikTok is holding too many unfinished drafts (${wall.drafts} of ${wall.limit}), so ${wall.stuck} TikTok posts are stuck${since}. Post or discard the drafts in the TikTok app; nothing new reaches TikTok until then.`
    );
  }
  const thin = shortsRunway(input.queue, input.platforms, input.shortsPerDay, now)
    .filter((entry) => entry.expected > 0 && entry.booked < entry.expected * RUNWAY_WARN_SHARE)
    .filter((entry) => !(wall && entry.platform === "tiktok"));
  if (thin.length) {
    const parts = thin.map((entry) => `${LABEL[entry.platform] ?? entry.platform} ${entry.booked} of ${entry.expected}`);
    issues.push(`Shorts booked for the next ${RUNWAY_DAYS} days: ${parts.join(", ")}. The schedule is running dry.`);
  }
  const waiting = unbookedStreams(input.runs, input.queue, now);
  if (waiting.length) {
    const names = waiting.map((stream) => shortStreamName(stream.name));
    const listed = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
    issues.push(
      `${waiting.length} recent stream${waiting.length === 1 ? " has" : "s have"} clips made and nothing booked: ${listed}. Open each on the Pipeline page and schedule its outputs.`
    );
  }
  return issues;
}
