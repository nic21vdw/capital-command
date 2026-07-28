import { threadsBlockedReason, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { planBatch } from "@/lib/threads/plan";
import { itemsForDate, mutateQueue, pruneOld } from "@/lib/threads/queue";
import { runDue } from "@/lib/threads/runner";
import { recordThreadsState } from "@/lib/threads/state";
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
    focus?: string;
    log?: (line: string) => void;
  } = {}
): Promise<ThreadsPlanResult> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.log(line));
  const date = localDateKey(now);

  const blocked = threadsBlockedReason(config);
  if (blocked) return { date, created: 0, droppedPastSlots: 0, skipped: blocked };

  const before = await mutateQueue((items) => {
    const kept = pruneOld(items, now, config);
    if (!options.force) return { items: kept, result: itemsForDate(kept, date) };
    // A forced replan clears only what has not gone out yet — anything already
    // published stays on the record.
    const cleared = kept.filter((item) => item.batchDate !== date || item.status !== "pending");
    return { items: cleared, result: itemsForDate(cleared, date) };
  });
  if (!options.force && before.length > 0) {
    return { date, created: 0, droppedPastSlots: 0, skipped: "Today's batch is already scheduled." };
  }
  const alreadySeen = new Set(before.map((item) => item.id));

  const { pack, cached, reason } = await ensureDailyPack({ focus: options.focus, force: options.force, date });
  log(
    `[threads] ${cached ? "using today's" : "generated a new"} pack (${pack.source}, ${pack.posts.length} posts)${
      reason ? ` — ${reason}` : ""
    }`
  );

  const { items, droppedPastSlots } = planBatch({ pack, config, now });
  if (items.length === 0) {
    return {
      date,
      created: 0,
      droppedPastSlots,
      skipped: "Every slot for today has already passed — the next batch starts tomorrow morning.",
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

  return { date, created: items.length, droppedPastSlots, packReason: reason, packSource: pack.source };
}

export type ThreadsTickResult = { plan: ThreadsPlanResult; run: ThreadsRunReport };

/**
 * One turn of the whole loop, and the only thing the scheduled task needs to
 * call: make sure today's batch exists, then post whatever is due. Running it
 * every few minutes is what makes the 24-hour cycle unattended.
 */
export async function threadsTick(
  options: { config?: ThreadsConfig; now?: Date; dryRun?: boolean; log?: (line: string) => void } = {}
): Promise<ThreadsTickResult> {
  const config = options.config ?? threadsConfig();
  const now = options.now ?? new Date();
  const plan = await planTodaysBatch({ config, now, log: options.log });
  const run = await runDue(now, { config, dryRun: options.dryRun, log: options.log });

  // Stamped every tick, busy or idle: a queue of pending posts looks the same
  // whether the scheduler is alive or was switched off days ago, and the
  // dashboard has no other way to tell.
  if (!options.dryRun) {
    await recordThreadsState({
      lastTickAt: now.toISOString(),
      ...(plan.created > 0 ? { lastPlanAt: now.toISOString(), lastPlanCreated: plan.created } : {}),
      ...(run.published > 0 ? { lastPostAt: now.toISOString() } : {})
    });
  }

  return { plan, run };
}
