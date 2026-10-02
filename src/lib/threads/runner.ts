import { isTransient } from "@/lib/publisher/http";
import { formatInTimezone } from "@/lib/publisher/time";
import { ContainerPendingError, ContainerRejectedError, ThreadsPublishPausedError, postToThreads, type ThreadsPublishInput } from "@/lib/threads/api";
import { plugReplyFor } from "@/lib/threads/plug";
import { findAccount, threadsBlockedReason, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
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
  post: (input: ThreadsPublishInput) => Promise<{
    containerId: string;
    postId: string;
  }>;
  /** Read the latest row and atomically save a claim prepared by this runner. */
  claim?: (id: string, prepare: (latest: ThreadsQueueItem) => boolean) => Promise<ThreadsQueueItem | undefined>;
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
    claim: async (id, prepare) => {
      const latest = await mutateQueue((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return { items: current, result: undefined };
        const fresh = structuredClone(item);
        const changed = prepare(fresh);
        return { items: changed ? current.map((entry) => entry.id === id ? fresh : entry) : current, result: changed ? fresh : item };
      });
      // Subsequent merges compare against the copy adopted at the claim, so
      // dashboard edits that this run has now seen are no longer stale diffs.
      if (latest) previous = previous.map((item) => item.id === id ? structuredClone(latest) : item);
      return latest;
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

/** Only failed saves need memory recovery; durable container handles cover restarts. */
type KnownDelivery = { containerId: string; postId?: string; publishedAt?: string; text: string; parentId?: string };
const defaultRecovery = new Map<string, KnownDelivery>();
const injectedRecovery = new WeakMap<ThreadsRunDeps, Map<string, KnownDelivery>>();
const MAX_REPLY_SENDS_PER_TICK = 3;

class QueuePersistenceError extends Error {
  constructor(error: unknown) {
    super(`The Threads queue could not be saved: ${error instanceof Error ? error.message : String(error)}. Delivery stopped until it can be saved.`);
  }
}

async function runDueInternal(
  now: Date,
  options: {
    config?: ThreadsConfig;
    deps?: ThreadsRunDeps;
    dryRun?: boolean;
    log?: (line: string) => void;
  }
): Promise<ThreadsRunReport> {
  const currentConfig = () => options.config ?? threadsConfig();
  const config = currentConfig();
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? ((line: string) => console.log(line));
  const outcomes: ThreadsOutcome[] = [];
  const replyOutcomes: ThreadsOutcome[] = [];
  let note: string | undefined;
  let persistenceError: string | undefined;
  const report = (): ThreadsRunReport => ({
    ran: now.toISOString(),
    published: outcomes.filter((outcome) => outcome.outcome === "published").length,
    failed: outcomes.filter((outcome) => outcome.outcome === "failed").length,
    skipped: outcomes.filter((outcome) => outcome.outcome === "skipped").length,
    outcomes,
    ...(replyOutcomes.length ? { replies: {
      published: replyOutcomes.filter((outcome) => outcome.outcome === "published").length,
      retrying: replyOutcomes.filter((outcome) => outcome.outcome === "retrying").length,
      failed: replyOutcomes.filter((outcome) => outcome.outcome === "failed").length,
      skipped: replyOutcomes.filter((outcome) => outcome.outcome === "skipped").length,
      outcomes: replyOutcomes
    } } : {}),
    ...(note ? { note } : {}),
    ...(persistenceError ? { persistenceError } : {}),
    dryRun
  });

  const blocked = threadsBlockedReason(config);
  if (blocked) return { ...report(), note: blocked };
  if (!dryRun && await isAutomationPaused("threads")) {
    return { ...report(), note: "Threads automation is paused in Automations." };
  }

  const deps = options.deps ?? defaultDeps(config);
  const recovery = options.deps
    ? injectedRecovery.get(deps) ?? new Map<string, KnownDelivery>()
    : defaultRecovery;
  if (options.deps) injectedRecovery.set(deps, recovery);
  const loaded = await deps.read();
  // Dry runs and failed saves must never modify the read snapshot in-place.
  const items = runOrder(structuredClone(pruneOld(loaded, now, config)));
  const deliveryKey = (item: ThreadsQueueItem, reply: boolean) => `${item.accountId}:${item.id}:${reply ? "reply" : "post"}`;
  const persist = async () => {
    if (dryRun) return;
    try {
      await deps.write(items);
      recovery.clear();
    } catch (error) {
      throw new QueuePersistenceError(error);
    }
  };

  const allowed = async (item: ThreadsQueueItem, reply: boolean, expectedToken?: string): Promise<boolean> => {
    const live = currentConfig();
    if (threadsBlockedReason(live) || (reply && (!live.plugReplies || !live.plugUrl))) return false;
    const original = findAccount(config, item.accountId);
    const account = findAccount(live, item.accountId);
    if (!account || account.accessToken !== (expectedToken ?? original?.accessToken)) return false;
    return dryRun || !await isAutomationPaused("threads");
  };

  const observe = (item: ThreadsQueueItem, outcome: ThreadsOutcome["outcome"], detail: string, reply = false) => {
    (reply ? replyOutcomes : outcomes).push({ itemId: item.id, slot: item.slot, accountId: item.accountId, outcome, detail });
    log(`[threads] slot ${item.slot} ${item.accountId}${reply ? " link reply" : ""} → ${outcome} — ${detail}`);
  };
  const record = async (item: ThreadsQueueItem, outcome: ThreadsOutcome["outcome"], detail: string, reply = false) => {
    observe(item, outcome, detail, reply);
    const at = new Date().toISOString();
    if (!dryRun) await recordAutomationEventSafely({
      automationId: "threads", scope: "delivery", kind: outcome === "published" ? "delivered" : outcome === "skipped" ? "blocked" : outcome,
      at, itemId: item.id, destination: `Threads / ${item.accountId}`, detail: `${item.topic}: ${reply ? "link reply: " : ""}${detail}`,
      nextAttemptAt: reply ? item.plugNextAttemptAt : item.nextAttemptAt,
      key: `${item.id}:${reply ? "reply:" : ""}${reply ? item.plugPostId ?? "" : item.postId ?? ""}:${reply ? item.plugAttempts ?? 0 : item.attempts}:${outcome === "failed" || outcome === "retrying" ? at : ""}`
    });
  };
  const saveAccepted = async (item: ThreadsQueueItem, detail: string, reply = false) => {
    try {
      await persist();
    } catch (error) {
      // The run can report a known acceptance immediately, while durable
      // delivery history waits for its queue receipt to be saved.
      observe(item, "published", detail, reply);
      throw error;
    }
    await record(item, "published", detail, reply);
  };

  let replySends = 0;
  const prepareReply = (item: ThreadsQueueItem): boolean => {
    const age = item.publishedAt ? (now.getTime() - new Date(item.publishedAt).getTime()) / 60_000 : NaN;
    const canPrepare = item.status === "pending" || (item.status === "published" && Number.isFinite(age) && age >= 0 && age <= config.plugWindowMinutes);
    if (!currentConfig().plugReplies || !currentConfig().plugUrl || !canPrepare || item.plugPostId || item.plugDropped || item.plugContainerId || item.plugClaimedAt || (item.plugAttempts ?? 0)) return false;
    const text = plugReplyFor(item.text, item.id, currentConfig(), item.origin);
    if (text === item.plugText) return false;
    item.plugText = text;
    return true;
  };
  const hasLiveClaim = (at?: string) => Boolean(at && now.getTime() - new Date(at).getTime() < config.claimTimeoutMinutes * 60_000);
  const retryWaiting = (at?: string) => Boolean(at && new Date(at).getTime() > now.getTime());
  const claimLatest = async (item: ThreadsQueueItem): Promise<"post" | "reply" | "unclaimed" | "missing"> => {
    if (!deps.claim || dryRun) return "unclaimed";
    let claimed: "post" | "reply" | "unclaimed" = "unclaimed";
    let latest;
    try { latest = await deps.claim(item.id, (fresh) => {
      if (threadsBlockedReason(currentConfig())) return false;
      const account = findAccount(currentConfig(), fresh.accountId);
      if (!account) return false;
      const prepared = prepareReply(fresh);
      const dueAt = new Date(fresh.publishAt).getTime();
      if (fresh.status === "pending" && !fresh.postId && Number.isFinite(dueAt) && dueAt <= now.getTime()
        && now.getTime() - dueAt <= config.lateGraceMinutes * 60_000
        && !retryWaiting(fresh.nextAttemptAt) && !hasLiveClaim(fresh.claimedAt)) {
        fresh.claimedAt = now.toISOString();
        claimed = "post";
        return true;
      }
      const age = fresh.publishedAt ? (now.getTime() - new Date(fresh.publishedAt).getTime()) / 60_000 : NaN;
      if (fresh.status === "published" && currentConfig().plugReplies && currentConfig().plugUrl && fresh.plugText && fresh.postId
        && !fresh.plugPostId && !fresh.plugDropped && Number.isFinite(age) && age >= config.plugDelayMinutes && age <= config.plugWindowMinutes
        && (fresh.plugAttempts ?? 0) < config.maxAttempts && !retryWaiting(fresh.plugNextAttemptAt) && !hasLiveClaim(fresh.plugClaimedAt)
        && replySends < MAX_REPLY_SENDS_PER_TICK) {
        fresh.plugClaimedAt = now.toISOString();
        claimed = "reply";
        return true;
      }
      return prepared;
    }); } catch (error) { throw new QueuePersistenceError(error); }
    if (!latest) return "missing";
    // Adopt the whole row, including deletions of optional fields, before any
    // due/status/copy decision. A later row may have changed during an upload.
    for (const key of Object.keys(item) as Array<keyof ThreadsQueueItem>) {
      if (!(key in latest)) Reflect.deleteProperty(item, key);
    }
    Object.assign(item, latest);
    return claimed;
  };
  const sendPlug = async (item: ThreadsQueueItem, alreadyClaimed = false) => {
    if (alreadyClaimed && !await allowed(item, true)) {
      delete item.plugClaimedAt;
      await persist();
      return;
    }
    if (!currentConfig().plugReplies || !currentConfig().plugUrl) return;
    if (!item.plugText || item.plugPostId || item.plugDropped || !item.postId || !item.publishedAt) return;
    const sinceMinutes = (now.getTime() - new Date(item.publishedAt).getTime()) / 60_000;
    if (!Number.isFinite(sinceMinutes) || sinceMinutes < config.plugDelayMinutes) return;

    const connected = findAccount(config, item.accountId);
    const account = connected ? { ...connected } : undefined;
    if (!account || sinceMinutes > config.plugWindowMinutes || (item.plugAttempts ?? 0) >= config.maxAttempts) {
      item.plugDropped = true;
      delete item.plugClaimedAt;
      delete item.plugNextAttemptAt;
      await persist();
      await record(item, !account || sinceMinutes > config.plugWindowMinutes ? "skipped" : "failed",
        !account ? "The account is no longer connected." : sinceMinutes > config.plugWindowMinutes ? "The reply window passed." : "The reply attempt limit was reached.", true);
      return;
    }
    if (item.plugNextAttemptAt && new Date(item.plugNextAttemptAt).getTime() > now.getTime()) return;
    if (!alreadyClaimed && hasLiveClaim(item.plugClaimedAt)) return;
    if (replySends >= MAX_REPLY_SENDS_PER_TICK || !await allowed(item, true)) return;

    if (dryRun) {
      replySends += 1;
      await record(item, "published", `Would reply as ${account.label}: "${item.plugText}"`, true);
      return;
    }

    if (!alreadyClaimed) {
      item.plugClaimedAt = now.toISOString();
      await persist();
    }
    const key = deliveryKey(item, true);
    let result;
    try {
      result = await deps.post({
        account, text: item.plugText, containerId: item.plugContainerId, replyToId: item.postId,
        shouldPublish: () => allowed(item, true, account.accessToken),
        onContainerCreated: async (containerId) => {
          item.plugContainerId = containerId;
          recovery.set(key, { containerId, text: item.plugText!, parentId: item.postId });
          await persist();
        }
      });
    } catch (error) {
      if (error instanceof QueuePersistenceError) throw error;
      if (error instanceof ContainerPendingError || error instanceof ContainerRejectedError || error instanceof ThreadsPublishPausedError) {
        item.plugContainerId = error.containerId ?? item.plugContainerId;
      }
      delete item.plugClaimedAt;
      if (error instanceof ThreadsPublishPausedError) {
        await persist();
        note = error.message;
        return;
      }
      replySends += 1;
      item.plugAttempts = (item.plugAttempts ?? 0) + 1;
      item.plugError = error instanceof Error ? error.message : String(error);
      if (!isTransient(error) || item.plugAttempts >= config.maxAttempts) {
        item.plugDropped = true;
        delete item.plugNextAttemptAt;
      } else {
        item.plugNextAttemptAt = new Date(now.getTime() + backoffMinutes(item.plugAttempts, config) * 60_000).toISOString();
      }
      await persist();
      await record(item, item.plugDropped ? "failed" : "retrying", `${item.plugError}${item.plugNextAttemptAt ? ` (retry at ${item.plugNextAttemptAt})` : ""}`, true);
      return;
    }
    replySends += 1;
    recovery.set(key, { ...result, text: item.plugText, parentId: item.postId });
    item.plugPostId = result.postId;
    item.plugContainerId = result.containerId;
    delete item.plugError;
    delete item.plugClaimedAt;
    delete item.plugNextAttemptAt;
    // A successful API call is still successful if the following queue save
    // fails. Keep the receipt in memory and reconcile it on the next tick.
    await saveAccepted(item, `${account.label} replied ${result.postId}.`, true);
  };

  try {
    let changed = items.length !== loaded.length;
    const recoveredReplies: Array<{ item: ThreadsQueueItem; detail: string }> = [];
    for (const item of items) {
      for (const reply of [false, true]) {
        const receipt = recovery.get(deliveryKey(item, reply));
        const text = reply ? item.plugText : item.text;
        if (!receipt || receipt.text !== text || (reply && receipt.parentId !== item.postId)) continue;
        if (reply) {
          item.plugContainerId = receipt.containerId;
          if (receipt.postId) {
            item.plugPostId = receipt.postId;
            delete item.plugError;
            delete item.plugNextAttemptAt;
            recoveredReplies.push({ item, detail: `Already on Threads as ${receipt.postId}; recording the accepted reply.` });
          }
          delete item.plugClaimedAt;
        } else {
          item.containerId = receipt.containerId;
          if (receipt.postId) {
            item.postId = receipt.postId;
            item.publishedAt = receipt.publishedAt;
          }
          delete item.claimedAt;
        }
        changed = true;
      }
      // Older queued posts acquire the current reply; recently published posts
      // can acquire one only inside their reply window. History stays history.
      changed = prepareReply(item) || changed;
    }
    if (changed) {
      try { await persist(); } catch (error) {
        for (const receipt of recoveredReplies) observe(receipt.item, "published", receipt.detail, true);
        throw error;
      }
    }
    for (const receipt of recoveredReplies) await record(receipt.item, "published", receipt.detail, true);

    for (const item of items) {
      const liveBlocked = threadsBlockedReason(currentConfig());
      if (liveBlocked || (!dryRun && await isAutomationPaused("threads"))) {
        note = liveBlocked ?? "Threads automation is paused in Automations.";
        break;
      }
      // The retained queue includes days of terminal history. Only rows this
      // tick could act on need a fresh atomic claim and its disk write.
      if (item.status !== "pending" && item.status !== "published") continue;
      if (item.status === "published" && (!currentConfig().plugReplies || !item.plugText || item.plugPostId || item.plugDropped || !item.postId || !item.publishedAt)) continue;
      if (item.status === "pending" && !item.postId && (new Date(item.publishAt).getTime() > now.getTime() || retryWaiting(item.nextAttemptAt) || hasLiveClaim(item.claimedAt))) continue;
      if (item.status === "published" && (retryWaiting(item.plugNextAttemptAt) || hasLiveClaim(item.plugClaimedAt))) continue;
      const claimed = await claimLatest(item);
      if (claimed === "missing") continue;
      if (item.status === "published") {
        await sendPlug(item, claimed === "reply");
        continue;
      }
      if (item.status !== "pending") continue;

      if (item.postId) {
        item.status = "published";
        item.publishedAt ??= now.toISOString();
        delete item.error;
        delete item.nextAttemptAt;
        delete item.claimedAt;
        await saveAccepted(item, `Already on Threads as ${item.postId}; recorded instead of posting it again.`);
        continue;
      }

      const dueAt = new Date(item.publishAt).getTime();
      if (dueAt > now.getTime()) continue;
      const lateMinutes = (now.getTime() - dueAt) / 60_000;
      if (lateMinutes > config.lateGraceMinutes) {
        item.status = "skipped";
        item.note = `Missed its ${formatInTimezone(new Date(item.publishAt), config.timezone)} slot by ${Math.round(lateMinutes)} min — skipped so the feed doesn't get a backlog all at once.`;
        delete item.claimedAt;
        await persist();
        await record(item, "skipped", item.note);
        continue;
      }
      if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > now.getTime()) continue;
      if (claimed !== "post" && hasLiveClaim(item.claimedAt)) continue;

      const connected = findAccount(config, item.accountId);
      const account = connected ? { ...connected } : undefined;
      if (!account) {
        item.status = "skipped";
        item.note = `The "${item.accountId}" account is no longer connected, so this post was skipped.`;
        await persist();
        await record(item, "skipped", item.note);
        continue;
      }
      if (dryRun) {
        await record(item, "published", `Would post as ${account.label}: "${item.text.slice(0, 60)}…"`);
        continue;
      }

      if (claimed !== "post") {
        item.claimedAt = now.toISOString();
        await persist();
      }
      const key = deliveryKey(item, false);
      let result;
      try {
        result = await deps.post({
          account, text: item.text, containerId: item.containerId,
          shouldPublish: () => allowed(item, false, account.accessToken),
          onContainerCreated: async (containerId) => {
            item.containerId = containerId;
            recovery.set(key, { containerId, text: item.text });
            await persist();
          }
        });
      } catch (error) {
        if (error instanceof QueuePersistenceError) throw error;
        if (error instanceof ContainerPendingError || error instanceof ContainerRejectedError || error instanceof ThreadsPublishPausedError) {
          item.containerId = error.containerId ?? item.containerId;
        }
        delete item.claimedAt;
        if (error instanceof ThreadsPublishPausedError) {
          await persist();
          note = error.message;
          break;
        }
        item.attempts += 1;
        item.error = error instanceof Error ? error.message : String(error);
        if (!isTransient(error) || item.attempts >= config.maxAttempts) {
          item.status = "failed";
          delete item.nextAttemptAt;
          await persist();
          await record(item, "failed", item.error);
        } else {
          const wait = backoffMinutes(item.attempts, config);
          item.nextAttemptAt = new Date(now.getTime() + wait * 60_000).toISOString();
          await persist();
          await record(item, "retrying", `${item.error} (retrying in ${wait} min)`);
        }
        continue;
      }
      item.status = "published";
      item.postId = result.postId;
      item.containerId = result.containerId;
      item.publishedAt = new Date().toISOString();
      delete item.error;
      delete item.nextAttemptAt;
      delete item.claimedAt;
      recovery.set(key, { ...result, text: item.text, publishedAt: item.publishedAt });
      await saveAccepted(item, `${account.label} posted ${result.postId}.`);
    }
  } catch (error) {
    if (!(error instanceof QueuePersistenceError)) throw error;
    note = error.message;
    persistenceError = error.message;
    log(`[threads] ${note}`);
  }
  return report();
}
