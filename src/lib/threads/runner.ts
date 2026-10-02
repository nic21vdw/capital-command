import { isTransient } from "@/lib/publisher/http";
import { formatInTimezone } from "@/lib/publisher/time";
import { ContainerPendingError, postToThreads } from "@/lib/threads/api";
import { findAccount, threadsBlockedReason, threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { mergeQueueChanges, mutateQueue, pruneOld, readQueue } from "@/lib/threads/queue";
import type { ThreadsOutcome, ThreadsQueueItem, ThreadsRunReport } from "@/lib/threads/types";
import { isAutomationPaused } from "@/lib/automations/store";
import { recordAutomationEventSafely } from "@/lib/automations/history";

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
  post: (input: { account: ThreadsAccount; text: string; containerId?: string; replyToId?: string }) => Promise<{
    containerId: string;
    postId: string;
  }>;
};

function defaultDeps(config: ThreadsConfig): ThreadsRunDeps {
  let previous: ThreadsQueueItem[] = [];
  return {
    read: async () => {
      const items = await readQueue();
      previous = structuredClone(items);
      return items;
    },
    write: async (items) => {
      await mutateQueue((current) => ({ items: mergeQueueChanges(previous, items, current), result: undefined }));
      previous = structuredClone(items);
    },
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
  if (options.dryRun) return runDueInternal(now, options);
  if (activeRun) {
    return {
      ran: now.toISOString(), published: 0, failed: 0, skipped: 0, outcomes: [], dryRun: false,
      note: "A Threads publish run is already in progress. The next tick will pick up anything left."
    };
  }
  const pending = runDueInternal(now, options);
  activeRun = pending;
  try {
    return await pending;
  } finally {
    activeRun = null;
  }
}

let activeRun: Promise<ThreadsRunReport> | null = null;

async function runDueInternal(
  now: Date,
  options: {
    config?: ThreadsConfig;
    deps?: ThreadsRunDeps;
    dryRun?: boolean;
    log?: (line: string) => void;
  }
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
  if (!dryRun && await isAutomationPaused("threads")) {
    return { ...report(), note: "Threads automation is paused in Automations." };
  }

  const deps = options.deps ?? defaultDeps(config);
  const loaded = await deps.read();
  const items = runOrder(pruneOld(loaded, now, config));
  if (items.length !== loaded.length && !dryRun) await deps.write(items);

  const record = async (item: ThreadsQueueItem, outcome: ThreadsOutcome["outcome"], detail: string) => {
    outcomes.push({ itemId: item.id, slot: item.slot, accountId: item.accountId, outcome, detail });
    const at = new Date().toISOString();
    if (!dryRun) await recordAutomationEventSafely({
      automationId: "threads", scope: "delivery", kind: outcome === "published" ? "delivered" : outcome === "skipped" ? "blocked" : outcome,
      at, itemId: item.id, destination: `Threads / ${item.accountId}`, detail: `${item.topic}: ${detail}`,
      nextAttemptAt: item.nextAttemptAt, key: `${item.id}:${item.postId ?? ""}:${item.attempts}:${outcome === "failed" || outcome === "retrying" ? at : ""}`
    });
    log(`[threads] slot ${item.slot} ${item.accountId} → ${outcome} — ${detail}`);
  };

  const sendPlug = async (item: ThreadsQueueItem) => {
    if (!item.plugText || item.plugPostId || item.plugDropped || !item.postId || !item.publishedAt) return;
    const sinceMinutes = (now.getTime() - new Date(item.publishedAt).getTime()) / 60_000;
    if (sinceMinutes < config.plugDelayMinutes) return;

    const account = findAccount(config, item.accountId);
    if (!account || sinceMinutes > config.plugWindowMinutes || (item.plugAttempts ?? 0) >= config.maxAttempts) {
      item.plugDropped = true;
      if (!dryRun) await deps.write(items);
      log(`[threads] slot ${item.slot} ${item.accountId} link reply dropped`);
      return;
    }

    if (dryRun) {
      log(`[threads] slot ${item.slot} ${item.accountId} would reply: "${item.plugText}"`);
      return;
    }

    try {
      const result = await deps.post({
        account,
        text: item.plugText,
        containerId: item.plugContainerId,
        replyToId: item.postId
      });
      item.plugPostId = result.postId;
      item.plugContainerId = result.containerId;
      item.plugError = undefined;
      log(`[threads] slot ${item.slot} ${item.accountId} link reply ${result.postId}`);
    } catch (error) {
      if (error instanceof ContainerPendingError) item.plugContainerId = error.containerId;
      item.plugAttempts = (item.plugAttempts ?? 0) + 1;
      item.plugError = error instanceof Error ? error.message : String(error);
      if (!isTransient(error)) item.plugDropped = true;
      log(`[threads] slot ${item.slot} ${item.accountId} link reply failed: ${item.plugError}`);
    }
    await deps.write(items);
    await recordAutomationEventSafely({
      automationId: "threads", scope: "delivery", kind: item.plugPostId ? "delivered" : item.plugDropped || (item.plugAttempts ?? 0) >= config.maxAttempts ? "failed" : "retrying",
      at: new Date().toISOString(), itemId: item.id, destination: `Threads / ${item.accountId}`, detail: `${item.topic}: link reply ${item.plugPostId ? "published" : item.plugError ?? "not delivered"}`,
      key: `${item.id}:reply:${item.plugPostId ?? ""}:${item.plugAttempts ?? 0}:${item.plugPostId ? "" : new Date().toISOString()}`
    });
  };

  for (const item of items) {
    if (!dryRun && await isAutomationPaused("threads")) break;
    if (item.status === "published") {
      await sendPlug(item);
      continue;
    }
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
      await record(item, "published", `Already on Threads as ${item.postId}  -  recorded instead of posting it again.`);
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
      await record(item, "skipped", item.note);
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
      await record(item, "skipped", item.note);
      continue;
    }

    if (dryRun) {
      await record(item, "published", `Would post as ${account.label}: "${item.text.slice(0, 60)}…"`);
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
      await record(item, "published", `${account.label} posted ${result.postId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ContainerPendingError) item.containerId = error.containerId;
      item.attempts += 1;
      item.error = message;
      delete item.claimedAt;

      if (!isTransient(error) || item.attempts >= config.maxAttempts) {
        item.status = "failed";
        await deps.write(items);
        await record(item, "failed", message);
      } else {
        const wait = backoffMinutes(item.attempts, config);
        item.nextAttemptAt = new Date(now.getTime() + wait * 60_000).toISOString();
        await deps.write(items);
        await record(item, "retrying", `${message} (retrying in ${wait} min)`);
      }
    }
  }

  return report();
}
