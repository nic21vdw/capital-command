import { isTransient } from "@/lib/publisher/http";
import { formatInTimezone } from "@/lib/publisher/time";
import { ContainerPendingError, postToThreads } from "@/lib/threads/api";
import { findAccount, threadsBlockedReason, threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { pruneOld, readQueue, writeQueue } from "@/lib/threads/queue";
import type { ThreadsOutcome, ThreadsQueueItem, ThreadsRunReport } from "@/lib/threads/types";

/**
 * The runner: post everything that is due, leave everything else alone.
 *
 * Two rules make repeated ticks safe. `published` and `failed` are terminal, so
 * a post can never go out twice. And a post more than the grace period late is
 * skipped rather than fired, so a machine that was asleep all morning wakes up
 * to a quiet feed instead of a burst.
 *
 * Each item names the account that posts it, so one account's expired token
 * fails only its own half of the day.
 */

export type ThreadsRunDeps = {
  read: () => Promise<ThreadsQueueItem[]>;
  write: (items: ThreadsQueueItem[]) => Promise<void>;
  post: (input: { account: ThreadsAccount; text: string; containerId?: string }) => Promise<{
    containerId: string;
    postId: string;
  }>;
};

function defaultDeps(config: ThreadsConfig): ThreadsRunDeps {
  return {
    read: readQueue,
    write: writeQueue,
    post: (input) => postToThreads(input, config)
  };
}

function backoffMinutes(attempts: number, config: ThreadsConfig): number {
  return Math.min(config.backoffCapMinutes, config.backoffBaseMinutes * 2 ** Math.max(0, attempts - 1));
}

/** Ordering the runner walks: earliest first, then by slot and account. */
function runOrder(items: ThreadsQueueItem[]): ThreadsQueueItem[] {
  return [...items].sort(
    (a, b) => a.publishAt.localeCompare(b.publishAt) || a.slot - b.slot || a.accountId.localeCompare(b.accountId)
  );
}

export async function runDue(
  now: Date = new Date(),
  options: {
    config?: ThreadsConfig;
    deps?: ThreadsRunDeps;
    dryRun?: boolean;
    log?: (line: string) => void;
  } = {}
): Promise<ThreadsRunReport> {
  const config = options.config ?? threadsConfig();
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? ((line: string) => console.log(line));
  const outcomes: ThreadsOutcome[] = [];
  const report = (): ThreadsRunReport => ({
    ran: now.toISOString(),
    published: outcomes.filter((outcome) => outcome.outcome === "published").length,
    failed: outcomes.filter((outcome) => outcome.outcome === "failed").length,
    skipped: outcomes.filter((outcome) => outcome.outcome === "skipped").length,
    outcomes,
    dryRun
  });

  const blocked = threadsBlockedReason(config);
  if (blocked) return { ...report(), note: blocked };

  const deps = options.deps ?? defaultDeps(config);
  const loaded = await deps.read();
  const items = runOrder(pruneOld(loaded, now, config));
  if (items.length !== loaded.length && !dryRun) await deps.write(items);

  const record = (item: ThreadsQueueItem, outcome: ThreadsOutcome["outcome"], detail: string) => {
    outcomes.push({ itemId: item.id, slot: item.slot, accountId: item.accountId, outcome, detail });
    log(`[threads] slot ${item.slot} ${item.accountId} → ${outcome} — ${detail}`);
  };

  for (const item of items) {
    if (item.status !== "pending") continue;

    // Already has a Threads post id: it went live and the queue never got to
    // record it (a write that failed after the post landed). Reconcile the
    // record rather than posting the same text a second time.
    if (item.postId) {
      item.status = "published";
      item.publishedAt ??= now.toISOString();
      item.error = undefined;
      delete item.nextAttemptAt;
      delete item.claimedAt;
      if (!dryRun) await deps.write(items);
      record(item, "published", `Already on Threads as ${item.postId} — recorded instead of posting it again.`);
      continue;
    }

    const dueAt = new Date(item.publishAt).getTime();
    if (dueAt > now.getTime()) continue;

    const lateMinutes = (now.getTime() - dueAt) / 60_000;
    if (lateMinutes > config.lateGraceMinutes) {
      item.status = "skipped";
      item.note = `Missed its ${formatInTimezone(new Date(item.publishAt), config.timezone)} slot by ${Math.round(
        lateMinutes
      )} min — skipped so the feed doesn't get a backlog all at once.`;
      delete item.claimedAt;
      if (!dryRun) await deps.write(items);
      record(item, "skipped", item.note);
      continue;
    }

    if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > now.getTime()) continue;
    if (item.claimedAt && now.getTime() - new Date(item.claimedAt).getTime() < config.claimTimeoutMinutes * 60_000) {
      continue;
    }

    // An account can disappear from .env between planning and posting; its
    // queued posts are retired rather than left pending forever.
    const account = findAccount(config, item.accountId);
    if (!account) {
      item.status = "skipped";
      item.note = `The "${item.accountId}" account is no longer connected, so this post was skipped.`;
      if (!dryRun) await deps.write(items);
      record(item, "skipped", item.note);
      continue;
    }

    if (dryRun) {
      record(item, "published", `Would post as ${account.label}: "${item.text.slice(0, 60)}…"`);
      continue;
    }

    item.claimedAt = now.toISOString();
    await deps.write(items);

    try {
      const result = await deps.post({ account, text: item.text, containerId: item.containerId });
      item.status = "published";
      item.postId = result.postId;
      item.containerId = result.containerId;
      item.publishedAt = new Date().toISOString();
      item.error = undefined;
      delete item.nextAttemptAt;
      delete item.claimedAt;
      await deps.write(items);
      record(item, "published", `${account.label} posted ${result.postId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ContainerPendingError) item.containerId = error.containerId;
      item.attempts += 1;
      item.error = message;
      delete item.claimedAt;

      if (!isTransient(error) || item.attempts >= config.maxAttempts) {
        item.status = "failed";
        await deps.write(items);
        record(item, "failed", message);
      } else {
        const wait = backoffMinutes(item.attempts, config);
        item.nextAttemptAt = new Date(now.getTime() + wait * 60_000).toISOString();
        await deps.write(items);
        record(item, "retrying", `${message} (retrying in ${wait} min)`);
      }
    }
  }

  return report();
}
