import { localCalendarParts, zonedToUtc } from "@/lib/publisher/time";
import { MIN_GAP_MINUTES, THREADS_TEXT_LIMIT, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { scheduleWindow } from "@/lib/x-posts/generator";
import type { XDailyPack, XSuggestedPost } from "@/types/domain";

/**
 * Turns a generated day pack into queue items — pure, so the whole scheduling
 * decision is testable without a filesystem or a network.
 *
 * One item per slot per connected account, each carrying the version of the
 * idea that account posts: the punchy `text` or the warmer `threadsVariant`.
 * Slot times are the pack's wall-clock times read in the configured timezone,
 * plus the account's own offset so two feeds don't fire in lockstep.
 *
 * Slots whose time has already passed are dropped, never scheduled into the
 * past. That is what keeps a batch planned at 2pm from firing seven backdated
 * posts at once — the day simply starts from the next open slot.
 *
 * `startNow` is the other way in, and the one the dashboard's two-button flow
 * uses: ignore the pack's wall-clock times entirely and lay the whole batch out
 * from the moment the button was pressed, keeping the pack's own rhythm but
 * tightening it as far as MIN_GAP_MINUTES so the last post still lands before
 * midnight. Anything that still doesn't fit is dropped rather than spilling
 * into tomorrow, where it would collide with tomorrow's batch.
 */

/** Fallback rhythm when a pack's own slot times say nothing useful. */
const DEFAULT_GAP_MINUTES = 40;
/** The first post of a start-now batch goes out on the very next tick. */
const FIRST_POST_DELAY_MINUTES = 1;

export { MIN_GAP_MINUTES };

/** Trims to the Threads limit on a word boundary, without a dangling ellipsis. */
export function fitToThreads(text: string, limit = THREADS_TEXT_LIMIT): string {
  const clean = text.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function textFor(post: XSuggestedPost, account: ThreadsAccount): string {
  return account.posts === "variant" ? post.threadsVariant : post.text;
}

export type PlanBatchInput = {
  pack: XDailyPack;
  config: ThreadsConfig;
  now: Date;
  /** Lay the batch out from `now` instead of the pack's wall-clock times. */
  startNow?: boolean;
  /**
   * Slots that already went out today. Re-running the day from now must not
   * repost an idea the feed has already seen, so they are left out entirely —
   * the layout closes up around them.
   */
  skipSlots?: Set<number>;
  /**
   * Floor on how tightly a start-now batch may be packed. The dashboard button
   * takes the default and crams the day; an automatic catch-up passes a much
   * wider gap and simply drops what won't fit, so rescuing a lost morning can
   * never read as a burst.
   */
  minGapMinutes?: number;
  /** Injected in tests so ids are predictable. */
  newId?: () => string;
};

export type PlanBatchOutput = {
  items: ThreadsQueueItem[];
  /**
   * Slots left out: their time had already passed, or — starting from now —
   * there was no room left in the day for them.
   */
  droppedPastSlots: number;
  /** When the first post goes out, and the spacing between them (start-now). */
  startedAt?: string;
  gapMinutes?: number;
};

/** The instant the local day rolls over. */
export function endOfLocalDay(now: Date, timezone: string): Date {
  const { dateKey } = localCalendarParts(now, timezone);
  const [year, month, day] = dateKey.split("-").map(Number);
  return zonedToUtc(timezone, year, month, day + 1, 0, 0, 0);
}

/**
 * The hard stop for a start-now batch: the end of the posting window, or
 * midnight when the window runs to the end of the day.
 *
 * Midnight alone is the wrong stop once the window is pulled back to waking
 * hours. Re-laying a missed morning would otherwise spread posts to 23:45 —
 * past the hour the machine gets switched off, so they would never fire, and
 * the day would report itself as recovered when it wasn't.
 */
export function endOfPostingDay(now: Date, config: ThreadsConfig): Date {
  const midnight = endOfLocalDay(now, config.timezone);
  // Only an explicitly configured window shortens the day. The default window
  // ends at 23:20 purely so the last slot isn't pinned to midnight, and reading
  // that as a curfew would quietly truncate every start-now batch.
  if (!process.env.THREADS_DAY_END?.trim()) return midnight;

  const { start, span } = scheduleWindow();
  const endMinutes = start + span;
  if (endMinutes >= 24 * 60) return midnight;

  const { dateKey } = localCalendarParts(now, config.timezone);
  const [year, month, day] = dateKey.split("-").map(Number);
  const windowEnd = zonedToUtc(
    config.timezone,
    year,
    month,
    day,
    Math.floor(endMinutes / 60),
    endMinutes % 60,
    0
  );
  return windowEnd.getTime() < midnight.getTime() ? windowEnd : midnight;
}

/** Minutes between the pack's own slots, so a start-now batch keeps its rhythm. */
function packGapMinutes(pack: XDailyPack): number {
  const minutes = pack.posts
    .map((post) => {
      const [hours, mins] = post.time.split(":").map(Number);
      return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
    })
    .filter((value): value is number => value !== null);
  const gaps = minutes.slice(1).map((value, index) => value - minutes[index]).filter((gap) => gap > 0);
  if (gaps.length === 0) return DEFAULT_GAP_MINUTES;
  return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
}

/**
 * The times a start-now batch fires: the pack's rhythm if the rest of the day
 * can hold it, squeezed down to MIN_GAP_MINUTES if not, and truncated rather
 * than allowed to run past midnight into tomorrow's batch.
 */
function startNowTimes(pack: XDailyPack, config: ThreadsConfig, now: Date, count: number, minGap: number) {
  const first = now.getTime() + FIRST_POST_DELAY_MINUTES * 60_000;
  const endOfDay = endOfPostingDay(now, config).getTime();

  const room = Math.max(0, endOfDay - first);
  const maxGap = count > 1 ? Math.floor(room / (count - 1) / 60_000) : DEFAULT_GAP_MINUTES;
  const gapMinutes = Math.max(minGap, Math.min(packGapMinutes(pack), maxGap));

  const times: Date[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = first + index * gapMinutes * 60_000;
    if (at > endOfDay) break;
    times.push(new Date(at));
  }
  return { times, gapMinutes };
}

export function planBatch({
  pack,
  config,
  now,
  startNow,
  skipSlots,
  minGapMinutes,
  newId
}: PlanBatchInput): PlanBatchOutput {
  const nextId = newId ?? (() => `thread-${crypto.randomUUID()}`);
  const createdAt = now.toISOString();
  const [year, month, day] = pack.date.split("-").map(Number);
  const posts = pack.posts
    .slice(0, config.postsPerDay)
    .filter((post) => !skipSlots?.has(post.slot));
  const laidOut = startNow
    ? startNowTimes(pack, config, now, posts.length, Math.max(MIN_GAP_MINUTES, minGapMinutes ?? MIN_GAP_MINUTES))
    : null;

  const items: ThreadsQueueItem[] = [];
  let droppedPastSlots = 0;

  posts.forEach((post, index) => {
    const [hours, minutes] = post.time.split(":").map(Number);
    const slotAt =
      laidOut?.times[index] ?? (laidOut ? null : zonedToUtc(config.timezone, year, month, day, hours ?? 0, minutes ?? 0, 0));

    // The slot is judged by its own time, not each account's offset, so the two
    // accounts always stay in step: a slot is either scheduled for everyone or
    // dropped for everyone.
    if (!slotAt || slotAt.getTime() <= now.getTime()) {
      droppedPastSlots += 1;
      return;
    }

    for (const account of config.accounts) {
      items.push({
        id: nextId(),
        batchDate: pack.date,
        slot: post.slot,
        accountId: account.id,
        version: account.posts,
        topic: post.topic,
        format: post.format,
        text: fitToThreads(textFor(post, account)),
        publishAt: new Date(slotAt.getTime() + account.offsetMinutes * 60_000).toISOString(),
        status: "pending",
        attempts: 0,
        createdAt
      });
    }
  });

  return {
    items,
    droppedPastSlots,
    ...(laidOut
      ? { startedAt: laidOut.times[0]?.toISOString(), gapMinutes: laidOut.gapMinutes }
      : {})
  };
}
