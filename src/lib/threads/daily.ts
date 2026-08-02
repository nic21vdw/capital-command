import { localCalendarParts, zonedToUtc } from "@/lib/publisher/time";
import { threadsBlockedReason, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { endOfLocalDay, planBatch } from "@/lib/threads/plan";
import { itemsForDate, mutateQueue, pruneOld, readQueue } from "@/lib/threads/queue";
import { runDue } from "@/lib/threads/runner";
import { readThreadsState, recordThreadsState } from "@/lib/threads/state";
import type { ThreadsPlanResult, ThreadsRunReport } from "@/lib/threads/types";
import { ensureDailyPack } from "@/lib/x-posts/daily";
import { localDateKey } from "@/lib/x-strategy/analytics";

/**
 * The daily half of the autopilot: make sure today's batch exists.
 *
 * DeepSeek writes one pack a day (24 fresh angles against the positioning
 * brief, each with a Threads-flavoured rewrite), and this schedules both
 * versions of every slot onto the queue. It is idempotent behind a batch-date
 * check, so the tick can call it every few minutes all day and it does real
 * work exactly once.
 */

export async function planTodaysBatch(
  options: {
    config?: ThreadsConfig;
    now?: Date;
    /** Replace today's batch with a freshly generated pack. */
    force?: boolean;
    /**
     * Run the day from this moment instead of the pack's clock times — the
     * dashboard's "Schedule from now" button. It replaces what is still pending
     * but reuses today's pack, so it can follow a Generate without paying for a
     * second one.
     */
    startNow?: boolean;
    /**
     * Which day to plan. Defaults to today; the tick passes tomorrow in the
     * evening so a round-the-clock day exists before its first slot arrives.
     */
    date?: string;
    /** Floor on the spacing of a start-now layout (see PlanBatchInput). */
    minGapMinutes?: number;
    focus?: string;
    log?: (line: string) => void;
  } = {}
): Promise<ThreadsPlanResult> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));
  const date = options.date ?? localDateKey(now);
  const replace = Boolean(options.force || options.startNow);

  const blocked = threadsBlockedReason(config);
  if (blocked) return { date, created: 0, droppedPastSlots: 0, skipped: blocked };

  const before = await mutateQueue((items) => {
    const kept = pruneOld(items, now, config);
    if (!replace) return { items: kept, result: itemsForDate(kept, date) };
    // A forced replan clears only what has not gone out yet — anything already
    // published stays on the record.
    const cleared = kept.filter((item) => item.batchDate !== date || item.status !== "pending");
    return { items: cleared, result: itemsForDate(cleared, date) };
  });
  if (!replace && before.length > 0) {
    return { date, created: 0, droppedPastSlots: 0, skipped: "Today's batch is already scheduled." };
  }
  const alreadySeen = new Set(before.map((item) => item.id));

  const { pack, cached, reason } = await ensureDailyPack({ focus: options.focus, force: options.force, date });
  log(
    `[threads] ${cached ? "using today's" : "generated a new"} pack (${pack.source}, ${pack.posts.length} posts)${
      reason ? ` — ${reason}` : ""
    }`
  );

  // Anything already live keeps its slot out of the running: pressing "Schedule
  // from now" at noon must not put the morning's posts back through the feed.
  const alreadyPosted = new Set(before.filter((item) => item.status === "published").map((item) => item.slot));

  const { items, droppedPastSlots, startedAt, gapMinutes } = planBatch({
    pack,
    config,
    now,
    startNow: options.startNow,
    minGapMinutes: options.minGapMinutes,
    skipSlots: alreadyPosted
  });
  if (items.length === 0) {
    const nothingLeft = pack.posts.slice(0, config.postsPerDay).every((post) => alreadyPosted.has(post.slot));
    return {
      date,
      created: 0,
      droppedPastSlots,
      skipped: nothingLeft
        ? "Every post in today's pack has already gone out — hit Generate 24 for a fresh day."
        : options.startNow
          ? "Too little of the day is left to schedule anything — try again tomorrow."
          : "Every slot for today has already passed — the next batch starts tomorrow morning.",
      packReason: reason,
      packSource: pack.source
    };
  }

  // Writing the batch is a SEPARATE read-modify-write from the check above, and
  // minutes of model time sit between them — long enough for the next scheduled
  // tick to start, see an empty day and plan it too. That once put two posts on
  // every slot of the day, at identical times. So the last word goes to whoever
  // writes first: if today grew an item this call did not start with, the loser
  // throws its work away rather than doubling the feed.
  const added = await mutateQueue((current) => {
    const raced = itemsForDate(current, date).some((item) => !alreadySeen.has(item.id));
    if (raced) return { items: current, result: false };
    return { items: [...current, ...items], result: true };
  });
  if (!added) {
    log(`[threads] another tick planned ${date} first — dropping this duplicate batch`);
    return { date, created: 0, droppedPastSlots, skipped: "Another tick planned today's batch first." };
  }

  log(
    `[threads] scheduled ${items.length} post(s) for ${date}${
      droppedPastSlots ? ` (${droppedPastSlots} slot(s) already past — dropped)` : ""
    }`
  );

  return {
    date,
    created: items.length,
    droppedPastSlots,
    startedAt,
    gapMinutes,
    packReason: reason,
    packSource: pack.source
  };
}

/** The local date key of the day after `now`, in the autopilot's timezone. */
export function nextDateKey(now: Date, config: ThreadsConfig): string {
  const { dateKey } = localCalendarParts(now, config.timezone);
  const [year, month, day] = dateKey.split("-").map(Number);
  // Noon, not midnight: a DST jump at the day boundary would otherwise land
  // back on the day it started from.
  const tomorrow = zonedToUtc(config.timezone, year, month, day + 1, 12, 0, 0);
  return localCalendarParts(tomorrow, config.timezone).dateKey;
}

/**
 * Plan TOMORROW, once the evening comes round.
 *
 * With slots spread across the whole clock, a day planned on the day itself
 * arrives with its early hours already gone — planning at 07:00 drops every
 * slot before it. Writing tomorrow's batch tonight is what makes the first
 * post of the day a 00:20 one instead of the first one after the machine woke
 * up. Idempotent behind the same batch-date check as today's plan, so the
 * evening's ticks pay for exactly one pack between them.
 */
export async function planTomorrow(
  options: { config?: ThreadsConfig; now?: Date; log?: (line: string) => void } = {}
): Promise<ThreadsPlanResult | null> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  const { time } = localCalendarParts(now, config.timezone);
  const hour = Number(time.split(":")[0]);
  if (!Number.isFinite(hour) || hour < config.planAheadHour) return null;

  const date = nextDateKey(now, config);
  const existing = itemsForDate(await readQueue(), date);
  if (existing.length > 0) return null;

  return planTodaysBatch({ ...options, config, now, date });
}

/**
 * Slots of a day that are still going to happen: already published, or pending
 * with their time still ahead. Anything else — skipped, failed, or never
 * scheduled because the day was planned late — is a hole in the day.
 */
export async function slotsStillStanding(date: string, now: Date): Promise<Set<number>> {
  const items = itemsForDate(await readQueue(), date);
  return new Set(
    items
      .filter(
        (item) =>
          item.status === "published" ||
          (item.status === "pending" && new Date(item.publishAt).getTime() > now.getTime())
      )
      .map((item) => item.slot)
  );
}

/**
 * Rescue a day that fell behind.
 *
 * The machine was off, or the app wouldn't start, and the slots that came due
 * meanwhile were skipped — correctly, because firing them late all at once is
 * the one thing this design refuses to do. But leaving it there means a day
 * that quietly delivers four posts instead of twenty-four, which is the whole
 * point of the autopilot missed.
 *
 * So: re-lay what is left across the time that remains, at a deliberately wide
 * spacing, dropping whatever still doesn't fit. That is the dashboard's
 * "Schedule from now" button, pressed automatically — not a backlog dump, and
 * bounded by a cooldown so a day that simply has no room left doesn't churn
 * its own queue every five minutes.
 */
export async function catchUpToday(
  options: { config?: ThreadsConfig; now?: Date; log?: (line: string) => void } = {}
): Promise<ThreadsPlanResult | null> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  if (!config.catchUp || threadsBlockedReason(config)) return null;

  const date = localDateKey(now);
  const standing = await slotsStillStanding(date, now);
  // Nothing planned at all is a day that hasn't been planned yet, not a day
  // that fell behind — leave that to the ordinary plan step.
  if (standing.size === 0) return null;
  if (config.postsPerDay - standing.size < config.catchUpMinShortfall) return null;

  const minutesLeft = (endOfLocalDay(now, config.timezone).getTime() - now.getTime()) / 60_000;
  if (minutesLeft < config.catchUpMinGapMinutes * 2) return null;

  const { lastCatchUpAt } = await readThreadsState();
  if (lastCatchUpAt) {
    const sinceMinutes = (now.getTime() - new Date(lastCatchUpAt).getTime()) / 60_000;
    if (sinceMinutes < config.catchUpCooldownMinutes) return null;
  }

  const log = options.log ?? ((line: string) => console.log(line));
  log(
    `[threads] ${date} is ${config.postsPerDay - standing.size} slot(s) short — re-laying the rest of the day from now`
  );
  const plan = await planTodaysBatch({
    config,
    now,
    log,
    startNow: true,
    minGapMinutes: config.catchUpMinGapMinutes
  });
  await recordThreadsState({ lastCatchUpAt: now.toISOString() });
  return plan;
}

export type ThreadsTickResult = {
  plan: ThreadsPlanResult;
  run: ThreadsRunReport;
  /** Tomorrow's batch, when this tick was the one that planned it. */
  ahead?: ThreadsPlanResult;
  /** The re-layout, when today had fallen behind enough to need one. */
  catchUp?: ThreadsPlanResult;
};

/**
 * One turn of the whole loop, and the only thing the scheduled task needs to
 * call. Four steps, each idempotent, so running it every few minutes forever is
 * the entire automation:
 *
 *   1. make sure today's batch exists
 *   2. from the evening on, write tomorrow's too — a round-the-clock day has to
 *      be on the queue before its first slot arrives
 *   3. if today fell behind, re-lay what is left across the rest of it
 *   4. post whatever is due
 */
export async function threadsTick(
  options: { config?: ThreadsConfig; now?: Date; dryRun?: boolean; log?: (line: string) => void } = {}
): Promise<ThreadsTickResult> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  const plan = await planTodaysBatch({ config, now, log: options.log });
  // Both of these change what is queued, so a dry run has to stay out of them.
  const ahead = options.dryRun ? null : await planTomorrow({ config, now, log: options.log });
  const catchUp = options.dryRun ? null : await catchUpToday({ config, now, log: options.log });
  const run = await runDue(now, { config, dryRun: options.dryRun, log: options.log });

  // Stamped every tick, busy or idle: a queue of pending posts looks the same
  // whether the scheduler is alive or was switched off days ago, and the
  // dashboard has no other way to tell.
  if (!options.dryRun) {
    const created = plan.created + (ahead?.created ?? 0) + (catchUp?.created ?? 0);
    await recordThreadsState({
      lastTickAt: now.toISOString(),
      ...(created > 0 ? { lastPlanAt: now.toISOString(), lastPlanCreated: created } : {}),
      ...(ahead?.created ? { plannedAheadFor: ahead.date } : {}),
      ...(run.published > 0 ? { lastPostAt: now.toISOString() } : {})
    });
  }

  return { plan, run, ...(ahead ? { ahead } : {}), ...(catchUp ? { catchUp } : {}) };
}
