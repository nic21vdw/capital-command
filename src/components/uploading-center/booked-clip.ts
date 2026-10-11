import { legAccountId } from "@/lib/publisher/boardActions";
import { PLATFORM_LABELS } from "@/lib/publisher/failure";
import { manualLabel, waitingForConnectionLabel } from "@/lib/publisher/nativeScheduling";
import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";
import { SCHEDULED_WORD, statusTone, type StatusTone } from "@/lib/statusTone";

/**
 * How a clip that is already on the schedule reads in the list. The card used
 * to stay exactly as it was before booking - a "Draft caption" box, ten
 * hashtag chips, a slot picker and a Schedule button - over a clip that was
 * already booked, so the list said "do this" about something done. A booked
 * clip collapses to a row that says WHEN and WHERE it was booked; the old
 * controls stay behind an "Edit for a new booking" disclosure. Pure, so the
 * wording is tested without a browser.
 *
 * "Booked" (the row's own word for the state, not its wording) means at least one leg that has not failed: a post whose every leg
 * failed is the opposite of done, and keeps the full card (and its retry
 * route) instead of being tidied away.
 */

export type BookedClip = {
  /** The booking the row is about: the earliest slot among live bookings. */
  item: QueueItem;
  /** The title that will actually post, which can differ from the draft box. */
  title: string;
  /**
   * "Scheduled Fri, Oct 12, 7:30 PM on YouTube and TikTok" (+ "and 1 more booking"),
   * or "Posted ..." once every leg is out, or "Partly posted ..." (naming the
   * platforms that are) while some are out and the rest are not. A leg that is
   * only a reminder or is waiting on a connection never reads as scheduled: the
   * row then says what the board's chip says ("Needs YouTube connection").
   */
  label: string;
  /** The tone of `label`, from the shared `statusTone` so the row and the board agree. */
  tone: StatusTone;
  /** How much of it has gone out: every leg, some of them, or none yet. */
  posted: "all" | "partly" | "none";
  /** The platforms with a live leg, in the app's usual order. */
  platforms: PlatformId[];
  /** Legs that failed on the bookings above: the row says so instead of hiding them. */
  failedLegs: number;
};

/** "YouTube", "YouTube and TikTok", "YouTube, TikTok and Instagram". */
export function listPlatforms(platforms: PlatformId[]): string {
  const names = platforms.map((platform) => PLATFORM_LABELS[platform]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Collapses a clip's queue items into one booked-row summary, or null when the
 * clip has no live booking. `formatWhen` is the card's own timestamp formatter
 * (publish-zone wall clock), so the row and the board agree on the time.
 */
export function bookedClip(
  items: QueueItem[],
  formatWhen: (iso: string) => string,
  options: {
    /** Whether the account a post uses on a platform has a connection; absent means connected. */
    isConnected?: (platform: PlatformId, accountId: string) => boolean;
    now?: Date;
  } = {}
): BookedClip | null {
  const { isConnected, now = new Date() } = options;
  const live = items
    .filter((item) => Object.values(item.platforms).some((state) => state && state.status !== "failed"))
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  const first = live[0];
  if (!first) return null;

  const on = new Set<PlatformId>();
  const out = new Set<PlatformId>();
  // Legs that are booked but cannot post by themselves: a reminder set aside
  // because nothing was connected, or a pending leg whose account is not.
  const waiting = new Map<PlatformId, string>();
  let failedLegs = 0;
  let legs = 0;
  let published = 0;
  for (const item of live) {
    for (const platform of ALL_PLATFORMS) {
      const state = item.platforms[platform];
      if (!state) continue;
      legs += 1;
      if (state.status === "failed") failedLegs += 1;
      else on.add(platform);
      const known = isConnected ? isConnected(platform, legAccountId(item, platform)) : undefined;
      if (state.status === "manual") {
        if (!waiting.has(platform)) waiting.set(platform, manualLabel(platform, item.publishAt, now, known));
      } else if (state.status === "pending" && known === false && !waiting.has(platform)) {
        waiting.set(platform, waitingForConnectionLabel(platform));
      }
      if (state.status === "published") {
        published += 1;
        out.add(platform);
      }
    }
  }
  const platforms = ALL_PLATFORMS.filter((platform) => on.has(platform));
  const posted: BookedClip["posted"] = published === 0 ? "none" : published === legs ? "all" : "partly";
  const slots = new Set(live.map((item) => item.publishAt)).size;
  const more = slots > 1 ? ` and ${slots - 1} more booking${slots === 2 ? "" : "s"}` : "";
  const when = formatWhen(first.publishAt);
  const base = { item: first, title: first.title, posted, platforms, failedLegs };

  // Once a leg is live the row says so, and names only the platforms that are.
  if (posted !== "none") {
    const verb = posted === "all" ? "Posted" : "Partly posted";
    const named = posted === "partly" ? ALL_PLATFORMS.filter((platform) => out.has(platform)) : platforms;
    return { ...base, label: `${verb} ${when} on ${listPlatforms(named)}${more}`, tone: "success" };
  }

  // Nothing posted, and something is waiting on a connection or the slot passed:
  // the board's chip words ("Needs YouTube connection", "Post by hand"), same tone.
  const waitingPlatforms = ALL_PLATFORMS.filter((platform) => waiting.has(platform));
  if (waitingPlatforms.length > 0) {
    const needing = waitingPlatforms.filter((platform) => waiting.get(platform) === waitingForConnectionLabel(platform));
    const others = [...new Set(waitingPlatforms.filter((platform) => !needing.includes(platform)).map((platform) => waiting.get(platform)!))];
    const words = [...(needing.length > 0 ? [`Needs ${listPlatforms(needing)} connection`] : []), ...others];
    const rest = platforms.filter((platform) => !waiting.has(platform));
    const alongside = rest.length > 0 ? `; ${SCHEDULED_WORD} on ${listPlatforms(rest)}` : "";
    return { ...base, label: `${words.join(", ")} - ${when}${alongside}${more}`, tone: statusTone(words[0]!) };
  }

  return { ...base, label: `${SCHEDULED_WORD} ${when} on ${listPlatforms(platforms)}${more}`, tone: statusTone(SCHEDULED_WORD) };
}
