import { historyDetail } from "@/lib/automations/history";
import type { ThreadsConfig } from "@/lib/threads/config";
import { plugReplyFor } from "@/lib/threads/plug";
import { threadsReplyUrl } from "@/lib/threads/reply-attribution";
import type { ThreadsQueueItem } from "@/lib/threads/types";

export type ThreadsReplyStatus = "delivered" | "pending" | "retrying" | "dropped" | "disabled";

export type ThreadsReplyPolicy = {
  enabled: boolean;
  delayMinutes: number;
  windowMinutes: number;
  url: string | null;
  disabledReason: string | null;
};

export type ThreadsReplyPreview = {
  itemId: string;
  status: ThreadsReplyStatus;
  text: string;
  detail: string;
  attempts: number;
  nextAttemptAt?: string;
  expiresAt?: string;
  error?: string;
};

export type ThreadsReplyCounts = Record<ThreadsReplyStatus, number> & { total: number };
export type ThreadsReplySummary = { today: ThreadsReplyCounts; items: ThreadsReplyPreview[] };

/** Queue errors are useful to review, credentials are not. */
export function safeThreadsDetail(detail: string | undefined, config: ThreadsConfig): string | undefined {
  if (!detail) return undefined;
  let safe = detail;
  for (const { accessToken } of config.accounts) {
    if (accessToken) safe = safe.split(accessToken).join("[hidden]");
  }
  return historyDetail(safe);
}

function safeReplyUrl(value: string): string | null {
  return threadsReplyUrl(value, { angle: "general" }) ? value : null;
}

export function threadsReplyPolicy(config: ThreadsConfig, paused = false): ThreadsReplyPolicy {
  const url = safeReplyUrl(config.plugUrl);
  const disabledReason = !config.plugReplies
    ? "Follow-up replies are switched off."
    : !config.enabled
      ? "Threads automation is switched off."
      : paused
        ? "Threads automation is paused."
        : !config.accounts.length
          ? "Connect a Threads account to send follow-up replies."
          : !url
            ? "The follow-up link is unavailable."
            : null;
  return {
    enabled: !disabledReason,
    delayMinutes: config.plugDelayMinutes,
    windowMinutes: config.plugWindowMinutes,
    url,
    disabledReason
  };
}

function validTime(value: string | undefined): number | undefined {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

// These optional fields are persisted by the reply runner. Keeping this shape
// local also lets the dashboard read queues written by older app versions.
type ReplyQueueItem = ThreadsQueueItem & {
  plugClaimedAt?: string;
  plugNextAttemptAt?: string;
  plugSourceText?: string;
};

export function previewThreadsReply(
  item: ReplyQueueItem,
  config: ThreadsConfig,
  now: Date,
  paused = false
): ThreadsReplyPreview | undefined {
  if (item.status === "failed" || item.status === "skipped") return undefined;
  const attempts = item.plugAttempts ?? 0;
  const published = validTime(item.publishedAt);
  const expired = published !== undefined && now.getTime() > published + config.plugWindowMinutes * 60_000;
  const started = Boolean(item.plugPostId || item.plugDropped || item.plugContainerId || item.plugClaimedAt || attempts > 0);
  if (started && !item.plugText) {
    return {
      itemId: item.id,
      status: item.plugPostId ? "delivered" : item.plugDropped ? "dropped" : "disabled",
      text: "",
      attempts,
      error: item.plugPostId ? undefined : safeThreadsDetail(item.plugError, config),
      detail: item.plugPostId
        ? "Reply published under this post; its saved copy is unavailable."
        : item.plugDropped
          ? "Reply was dropped; its saved copy is unavailable."
          : "The saved reply copy is missing; delivery cannot continue safely."
    };
  }
  // Backfill only recent posts. An old post that never had a reply planned
  // must not suddenly appear as a failed reply in today's delivery history.
  if (item.status === "published" && !item.plugText && !item.plugPostId && (published === undefined || expired)) return undefined;
  // Once a container exists or an attempt starts, its exact copy must survive
  // retries. Before then, an edit or an old queue entry gets a current preview.
  const locked = started || expired;
  const text = locked && item.plugText
    ? item.plugText
    : plugReplyFor(item.text, item.id, { ...config, plugReplies: true }, item.origin);
  if (!text) return undefined;

  const base = { itemId: item.id, text, attempts, error: safeThreadsDetail(item.plugError, config) };
  if (item.plugPostId) return { ...base, status: "delivered", detail: "Reply published under this post.", error: undefined };
  if (item.plugDropped) return { ...base, status: "dropped", detail: base.error ?? "Reply was not delivered and will not be retried." };

  const policy = threadsReplyPolicy(config, paused);
  if (!policy.enabled) return { ...base, status: "disabled", detail: policy.disabledReason! };
  if (!config.accounts.some((account) => account.id === item.accountId)) {
    return { ...base, status: "disabled", detail: "This post's Threads account is no longer connected." };
  }
  if (item.status === "pending") {
    return { ...base, status: "pending", detail: "Waiting for the original post to publish." };
  }
  if (!item.postId) {
    return { ...base, status: "disabled", detail: "The original post's Threads ID is missing; the reply cannot be sent." };
  }

  if (published === undefined) {
    return { ...base, status: "dropped", detail: "The original post's publish time is unavailable; the reply cannot be timed safely." };
  }
  const expiresAt = new Date(published + config.plugWindowMinutes * 60_000).toISOString();
  if (now.getTime() > Date.parse(expiresAt)) {
    return { ...base, status: "dropped", expiresAt, detail: "The reply window expired before delivery." };
  }
  if (attempts >= config.maxAttempts) {
    return { ...base, status: "dropped", expiresAt, detail: "The reply reached its retry limit." };
  }
  const nextAttemptAt = new Date(Math.max(
    published + config.plugDelayMinutes * 60_000,
    validTime(item.plugNextAttemptAt) ?? 0
  )).toISOString();
  if (validTime(item.plugClaimedAt) !== undefined && now.getTime() - Date.parse(item.plugClaimedAt!) < config.claimTimeoutMinutes * 60_000) {
    return { ...base, status: attempts ? "retrying" : "pending", nextAttemptAt, expiresAt, detail: "Sending reply; waiting for delivery confirmation." };
  }
  return {
    ...base,
    status: attempts ? "retrying" : "pending",
    nextAttemptAt,
    expiresAt,
    detail: attempts ? "Waiting for the next retry." : "Ready after the reply delay, on the next scheduler check."
  };
}

export function countThreadsReplies(items: ThreadsReplyPreview[]): ThreadsReplyCounts {
  const counts: ThreadsReplyCounts = { total: items.length, delivered: 0, pending: 0, retrying: 0, dropped: 0, disabled: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function summarizeThreadsReplies(
  items: ThreadsQueueItem[],
  date: string,
  config: ThreadsConfig,
  now: Date,
  paused = false
): ThreadsReplySummary {
  const previews = items.flatMap((item) => {
    const preview = previewThreadsReply(item, config, now, paused);
    return preview ? [preview] : [];
  });
  const todaysIds = new Set(items.filter((item) => item.batchDate === date).map((item) => item.id));
  return { today: countThreadsReplies(previews.filter((item) => todaysIds.has(item.itemId))), items: previews };
}
