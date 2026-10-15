import { localCalendarParts, zonedToUtc } from "@/lib/publisher/time";
import { envAccessTokens, threadsBlockedReason, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { endOfPostingDay, planBatch } from "@/lib/threads/plan";
import { autopilotItemsForDate, isAutopilotItem, mutateQueue, pruneOld, readQueue } from "@/lib/threads/queue";
import { hasStarted } from "@/lib/threads/rewrite";
import { runDue } from "@/lib/threads/runner";
import { readThreadsState, recordThreadsState } from "@/lib/threads/state";
import { refreshThreadsTokens, type TokenRefreshOutcome } from "@/lib/threads/tokens";
import type { ThreadsPlanResult, ThreadsRunReport } from "@/lib/threads/types";
import { ensureDailyPack } from "@/lib/x-posts/daily";
import { isAutomationPaused, recordAutomationOutcome } from "@/lib/automations/store";

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
     * Swap what is still unsent for a plan from today's CURRENT pack, without
     * generating one: pending rows and skipped ones (out of the running, nothing
     * sent) are cleared and laid out again at the pack's own times. This is what
     * follows a pack rewrite, so the queue and the pack say the same thing. Rows
     * that have started, and hand-added posts, are never touched.
     */
    replacePending?: boolean;
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
  const date = options.date ?? localCalendarParts(now, config.timezone).dateKey;
  const replace = Boolean(options.force || options.startNow || options.replacePending);

  if (await isAutomationPaused("threads")) {
    return { date, created: 0, droppedPastSlots: 0, skipped: "Threads automation is paused in Automations." };
  }

  const blocked = threadsBlockedReason(config);
  if (blocked) return { date, created: 0, droppedPastSlots: 0, skipped: blocked };

  const before = await mutateQueue((items) => {
    const kept = pruneOld(items, now, config);
    if (!replace) return { items: kept, result: autopilotItemsForDate(kept, date) };
    // Keep every account's row for a slot that is published or has started
    // sending. Removing an in-flight row would lose its container/receipt and
    // let the replacement publish the same idea again.
    const protectedSlots = new Set(autopilotItemsForDate(kept, date)
      .filter((item) => hasStarted(item) || item.status === "failed" || item.attempts > 0 || Boolean(item.lastFailedAt))
      .map((item) => item.slot));
    const clearable = (item: (typeof kept)[number]) =>
      item.status === "pending" || (Boolean(options.replacePending) && item.status === "skipped" && !hasStarted(item));
    const cleared = kept.filter(
      (item) => item.batchDate !== date || !clearable(item) || !isAutopilotItem(item) || protectedSlots.has(item.slot)
    );
    return { items: cleared, result: autopilotItemsForDate(cleared, date) };
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
  const alreadyPosted = new Set(before.filter((item) => hasStarted(item) || item.status === "failed" || item.attempts > 0 || Boolean(item.lastFailedAt)).map((item) => item.slot));

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
        ? "Every slot in today's pack has already published or started sending."
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
  if (await isAutomationPaused("threads")) {
    return { date, created: 0, droppedPastSlots, skipped: "Threads automation was paused while planning." };
  }
  const added = await mutateQueue((current) => {
    const raced = autopilotItemsForDate(current, date).some((item) => !alreadySeen.has(item.id));
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
  const existing = autopilotItemsForDate(await readQueue(), date);
  if (existing.length > 0) return null;

  return planTodaysBatch({ ...options, config, now, date });
}

/**
 * Slots of a day that are still going to happen: already published, or pending
 * with their time still ahead. Anything else — skipped, failed, or never
 * scheduled because the day was planned late — is a hole in the day.
 */
export async function slotsStillStanding(date: string, now: Date): Promise<Set<number>> {
  const items = autopilotItemsForDate(await readQueue(), date);
  return new Set(
    items
      .filter(
        (item) =>
          hasStarted(item) || item.status === "failed" || item.attempts > 0 || Boolean(item.lastFailedAt) ||
          (item.status === "pending" && new Date(item.publishAt).getTime() >= now.getTime())
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

  const date = localCalendarParts(now, config.timezone).dateKey;
  const standing = await slotsStillStanding(date, now);
  // A completely missed batch still exists and can recover; an empty day
  // belongs to the ordinary planner. Pipeline rows do not count as a batch.
  if (autopilotItemsForDate(await readQueue(), date).length === 0) return null;
  if (config.postsPerDay - standing.size < config.catchUpMinShortfall) return null;

  const minutesLeft = (endOfPostingDay(now, config).getTime() - now.getTime()) / 60_000;
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
  const { pack, reason } = await ensureDailyPack({ date });
  if (await isAutomationPaused("threads")) return null;
  const plan = await mutateQueue((items) => {
    const rows = autopilotItemsForDate(items, date);
    // A failed/attempted send or an explicit manual skip needs a person's
    // decision. Keep the whole slot protected across accounts.
    const protectedSlots = new Set(rows.filter((item) => hasStarted(item) || item.status === "failed"
      || item.attempts > 0 || item.lastFailedAt || item.note === "Skipped by hand from the dashboard.").map((item) => item.slot));
    const latestDelivery = Math.max(0, ...items.filter((item) => item.batchDate === date && hasStarted(item)).map((item) =>
      Date.parse(item.publishedAt ?? item.publishAttemptedAt ?? item.claimedAt ?? item.publishAt) || 0));
    // Leave the same breathing room after a recent/uncertain send as between
    // rescued slots. planBatch adds its own one-minute first-slot delay.
    const recoveryStart = new Date(Math.max(now.getTime(), latestDelivery + (config.catchUpMinGapMinutes - 1) * 60_000));
    const layout = planBatch({ pack, config, now: recoveryStart, startNow: true,
      minGapMinutes: config.catchUpMinGapMinutes, skipSlots: protectedSlots });
    const recovered = layout.items.map((planned) => {
      const saved = rows.find((item) => item.slot === planned.slot && item.accountId === planned.accountId);
      if (!saved) return planned;
      // Recovery changes the time, never reviewed wording or approval.
      const moved = { ...saved, publishAt: planned.publishAt, status: "pending" as const };
      delete moved.note;
      return moved;
    });
    const movedIds = new Set(recovered.map((item) => item.id));
    const remaining = items.filter((item) => !movedIds.has(item.id)).map((item) => {
      if (isAutopilotItem(item) && item.batchDate === date && item.status === "pending" && !protectedSlots.has(item.slot)) {
        return { ...item, status: "skipped" as const, note: "No room remains for this unsent slot at the catch-up spacing." };
      }
      return item;
    });
    return { items: [...remaining, ...recovered], result: {
      date, created: recovered.length, droppedPastSlots: layout.droppedPastSlots,
      startedAt: layout.startedAt, gapMinutes: layout.gapMinutes, packReason: reason, packSource: pack.source
    } };
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
  /** Token refreshes this tick made or failed; quiet when nothing was due. */
  tokens?: TokenRefreshOutcome[];
  /** Delivery still runs when generation or planning fails. */
  planningError?: string;
};

/**
 * One turn of the whole loop, and the only thing the scheduled task needs to
 * call. Four steps, each idempotent, so running it every few minutes forever is
 * the entire automation:
 *
 *   1. deliver the existing due queue before generation can delay it
 *   2. make sure today's batch exists
 *   3. if today fell behind, re-lay genuinely unsent slots
 *   4. from the evening on, write tomorrow's batch before midnight
 */
export async function threadsTick(
  options: Parameters<typeof threadsTickInternal>[0] = {}
): Promise<ThreadsTickResult> {
  try {
    const result = await threadsTickInternal(options);
    if (!options.dryRun) {
      const replies = result.run.replies;
      const needsAttention = Boolean(result.planningError) || Boolean(result.run.uncertainSends) || Boolean(result.run.persistenceError) || Boolean(result.run.authFailures?.length) || result.run.failed > 0 || result.run.outcomes.some((outcome) => outcome.outcome === "retrying")
        || Boolean(replies && (replies.failed > 0 || replies.retrying > 0));
      await recordAutomationOutcome("threads", {
        at: new Date().toISOString(),
        status: (await isAutomationPaused("threads")) ? "paused" : needsAttention ? "failed" : "completed",
        detail: `${result.run.published} posts published, ${result.run.failed} post failures.`
          + (replies ? ` ${replies.published} follow-up replies published, ${replies.failed} reply failures, ${replies.retrying} replies waiting to retry, ${replies.skipped} replies skipped.` : "")
          + (result.run.note ? ` ${result.run.note}` : "")
          + (result.planningError ? ` Planning failed: ${result.planningError}` : "")
      }).catch(() => undefined);
    }
    return result;
  } catch (error) {
    if (!options.dryRun) await recordAutomationOutcome("threads", { at: new Date().toISOString(), status: "failed", detail: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}

async function threadsTickInternal(
  options: {
    config?: ThreadsConfig;
    now?: Date;
    dryRun?: boolean;
    log?: (line: string) => void;
    /** Refresh tokens that are due before posting. Only the scheduled tick asks. */
    refreshTokens?: boolean;
  } = {}
): Promise<ThreadsTickResult> {
  let config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  if (await isAutomationPaused("threads")) {
    const note = "Threads automation is paused in Automations.";
    return {
      plan: { date: localCalendarParts(now, config.timezone).dateKey, created: 0, droppedPastSlots: 0, skipped: note },
      run: { ran: now.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: options.dryRun ?? false, note }
    };
  }
  // Keep the tokens alive before anything posts with them. A long-lived token
  // expires 60 days after it was minted, and an expired one silently stops the
  // whole feed. Rate-limited inside, so most ticks make no call at all.
  let tokens: TokenRefreshOutcome[] = [];
  if (options.refreshTokens && !options.dryRun) {
    tokens = (await refreshThreadsTokens(config, envAccessTokens(), now)).filter((entry) => entry.outcome !== "fresh");
    if (tokens.some((entry) => entry.outcome === "refreshed")) config = threadsConfig();
  }
  // Drain the existing due queue before any potentially slow generation.
  // Mutation and send passes remain sequential. Newly laid future slots are
  // picked up by the next tick, rather than holding delivery behind a writer.
  const run = await runDue(now, { config, dryRun: options.dryRun, log: options.log });
  let plan: ThreadsPlanResult = { date: localCalendarParts(now, config.timezone).dateKey, created: 0, droppedPastSlots: 0 };
  let ahead: ThreadsPlanResult | null = null;
  let catchUp: ThreadsPlanResult | null = null;
  let planningError: string | undefined;
  try {
    const planningNow = () => options.now ?? new Date();
    plan = await planTodaysBatch({ config, now: planningNow(), log: options.log });
    // Both of these change what is queued, so a dry run stays out of them.
    catchUp = options.dryRun ? null : await catchUpToday({ config, now: planningNow(), log: options.log });
    ahead = options.dryRun ? null : await planTomorrow({ config, now: planningNow(), log: options.log });
  } catch (error) {
    planningError = error instanceof Error ? error.message : String(error);
    plan.skipped ??= "Planning failed; existing due posts were processed first.";
    options.log?.(`[threads] planning failed: ${planningError}`);
  }

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

  return { plan, run, ...(ahead ? { ahead } : {}), ...(catchUp ? { catchUp } : {}), ...(tokens.length ? { tokens } : {}), ...(planningError ? { planningError } : {}) };
}
