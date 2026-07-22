import { bufferConfigured, publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { PermanentError, fetchJson, isTransient } from "@/lib/publisher/http";
import { composeCaption } from "@/lib/publisher/metadata";
import { newBufferState, type PublishQueue, publishQueue } from "@/lib/publisher/queue";
import { formatInTimezone } from "@/lib/publisher/time";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Buffer (buffer.com) delivery layer — the "social media manager" for the
 * queue. Connect your channels once inside Buffer, then let the runner schedule
 * every due post into Buffer with a future scheduled time; Buffer fans the post
 * out to all connected channels and publishes at the target time. This mirrors
 * the YouTube native-scheduling pattern (push once → Buffer publishes later),
 * so a Buffer post survives runner downtime the same way a YouTube one does.
 *
 * Buffer sits ALONGSIDE the four direct-API platforms, never inside them: it
 * has its own optional `buffer` field on the queue item and its own runner
 * pass, both gated on BUFFER_ENABLED. With Buffer off, none of this runs and
 * the publisher behaves exactly as before.
 *
 * Requests use the classic Buffer REST API
 * (https://buffer.com/developers/api). The base host is overridable via
 * BUFFER_API_BASE.
 */

type BufferCreateResponse = {
  success?: boolean;
  message?: string;
  buffer_count?: number;
  updates?: Array<{ id?: string; status?: string }>;
};

type BufferUpdateResponse = { id?: string; status?: string };

type BufferProfile = { id?: string; service?: string; formatted_username?: string };

function credentials(config: PublisherConfig): { token: string; profileIds: string[]; apiBase: string } {
  const { accessToken, profileIds, apiBase } = config.buffer;
  if (!accessToken || profileIds.length === 0) {
    throw new PermanentError(
      "Buffer is not configured. Set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS (comma-separated Buffer profile ids)."
    );
  }
  return { token: accessToken, profileIds, apiBase };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Builds the form body Buffer's create.json expects for one post. A hosted
 * public URL (from the S3/R2 media host) is attached as the update's media
 * link so Buffer has the clip to publish; without one the update is text-only.
 */
export function buildCreateBody(
  item: QueueItem,
  config: PublisherConfig,
  publicUrl: string | undefined
): URLSearchParams {
  const body = new URLSearchParams();
  for (const id of config.buffer.profileIds) body.append("profile_ids[]", id);
  body.set("text", composeCaption(item));
  // Buffer accepts ISO-8601; publishAt is already stored as UTC ISO.
  body.set("scheduled_at", item.publishAt);
  body.set("shorten", config.buffer.shortenLinks ? "true" : "false");
  if (publicUrl) {
    // VERIFY: the classic API attaches media through media[link]/media[thumbnail].
    // For video, Buffer pulls from this hosted URL — keep the media host public.
    body.set("media[link]", publicUrl);
    body.set("media[thumbnail]", publicUrl);
    if (item.title) body.set("media[title]", item.title);
  }
  return body;
}

/** Creates the scheduled Buffer update(s); returns the new update ids. */
export async function createBufferUpdate(
  item: QueueItem,
  config: PublisherConfig,
  publicUrl: string | undefined
): Promise<string[]> {
  const { token, apiBase } = credentials(config);
  const data = await fetchJson<BufferCreateResponse>(`${apiBase}/updates/create.json`, {
    label: "Buffer updates create",
    headers: { ...authHeader(token), "Content-Type": "application/x-www-form-urlencoded" },
    body: buildCreateBody(item, config, publicUrl)
  });
  if (!data.success) {
    throw new PermanentError(`Buffer did not accept the update${data.message ? `: ${data.message}` : "."}`);
  }
  const ids = (data.updates ?? []).map((u) => u.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) throw new PermanentError("Buffer create returned no update ids.");
  return ids;
}

/** Buffer status for one update: "buffer" (queued), "sent", "error", … */
export async function getBufferUpdateStatus(id: string, config: PublisherConfig): Promise<string> {
  const { token, apiBase } = credentials(config);
  const data = await fetchJson<BufferUpdateResponse>(`${apiBase}/updates/${encodeURIComponent(id)}.json`, {
    label: "Buffer update status",
    method: "GET",
    headers: authHeader(token)
  });
  return data.status ?? "unknown";
}

/** Lists the connected Buffer profiles — used by the CLI and auth check. */
export async function listBufferProfiles(config = publisherConfig()): Promise<BufferProfile[]> {
  const { token, apiBase } = credentials(config);
  const data = await fetchJson<BufferProfile[]>(`${apiBase}/profiles.json`, {
    label: "Buffer profiles",
    method: "GET",
    headers: authHeader(token)
  });
  return Array.isArray(data) ? data : [];
}

/** Exercises the token without posting, for dry runs / CLI checks. */
export async function validateBufferAuth(config = publisherConfig()): Promise<void> {
  await listBufferProfiles(config);
}

export type BufferOutcome = {
  itemId: string;
  clip: string;
  outcome: "scheduled" | "published" | "retrying" | "failed" | "manual" | "skipped";
  detail: string;
};

type BufferAction = "schedule" | "finalize" | null;

/**
 * What the Buffer pass should do for an item at `now`, respecting the same
 * claim/backoff gates as the per-platform runner:
 *  - "schedule": push the post into Buffer now with its future scheduled time
 *    (as soon as the runner first sees a pending item — downtime-proof, like
 *    YouTube's native scheduling);
 *  - "finalize": the update is scheduled and its publish time has passed, so
 *    verify Buffer actually sent it;
 *  - null: terminal (published/failed/manual) or gated by backoff/claim.
 */
export function bufferAction(item: QueueItem, now: Date, config: PublisherConfig): BufferAction {
  const state = item.buffer;
  if (state) {
    if (state.status === "published" || state.status === "failed" || state.status === "manual") return null;
    if (state.nextAttemptAt && new Date(state.nextAttemptAt).getTime() > now.getTime()) return null;
    if (state.claimedAt) {
      const claimAge = now.getTime() - new Date(state.claimedAt).getTime();
      if (claimAge < config.claimTimeoutMinutes * 60_000) return null;
    }
    if (state.status === "scheduled") {
      return new Date(item.publishAt).getTime() <= now.getTime() ? "finalize" : null;
    }
  }
  // No state yet, or still pending → schedule it into Buffer.
  return "schedule";
}

/**
 * The Buffer pass: schedule every due queue item into Buffer and finalize the
 * ones whose time has passed. Isolated from the per-platform loop — a Buffer
 * failure only records against `item.buffer`, never the platforms. Returns one
 * outcome per item it acted on.
 */
export async function syncDueToBuffer(
  now: Date = new Date(),
  options: {
    queue?: PublishQueue;
    config?: PublisherConfig;
    log?: (line: string) => void;
    /** Restrict to one queue item (the UI's per-post action). */
    itemId?: string;
  } = {}
): Promise<BufferOutcome[]> {
  const config = options.config ?? publisherConfig();
  const outcomes: BufferOutcome[] = [];
  if (!config.buffer.enabled) return outcomes;

  const queue = options.queue ?? publishQueue(config);
  const log = options.log ?? ((line: string) => console.log(line));
  const configured = bufferConfigured(config);

  let items = await queue.list();
  if (options.itemId) items = items.filter((item) => item.id === options.itemId);

  for (const item of items) {
    const action = bufferAction(item, now, config);
    if (!action) continue;

    const record = (outcome: BufferOutcome["outcome"], detail: string) => {
      outcomes.push({ itemId: item.id, clip: item.clipPath, outcome, detail });
      log(`[publisher]   ${item.id} → buffer: ${outcome} — ${detail}`);
    };

    // Buffer enabled but missing token/profiles: keep the post as a reminder
    // instead of failing, exactly like an unconnected direct platform.
    if (!configured) {
      if (item.buffer?.status !== "manual") {
        await queue.recordBufferManual(
          item,
          "Buffer is enabled but not connected (set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS) — post this by hand or finish the Buffer setup."
        );
        record("manual", "Buffer not connected — tracked as a reminder.");
      }
      continue;
    }

    try {
      if (action === "finalize") {
        item.buffer ??= newBufferState();
        await queue.claimBuffer(item, now);
        const ids = item.buffer.updateIds ?? [];
        const statuses = await Promise.all(ids.map((id) => getBufferUpdateStatus(id, config)));
        const allSent = statuses.length > 0 && statuses.every((s) => s === "sent");
        if (allSent) {
          await queue.recordBufferSuccess(item, { status: "published", updateIds: ids }, now);
          record("published", `Buffer sent ${ids.length} update(s).`);
        } else {
          // Still queued in Buffer — leave it scheduled; it will re-check next run.
          await queue.recordBufferSuccess(item, { status: "scheduled", updateIds: ids }, now);
          record("scheduled", `Buffer still holding the post (statuses: ${statuses.join(", ") || "none"}).`);
        }
        continue;
      }

      await queue.claimBuffer(item, now);
      const publicUrl = item.mediaKey ? ((await mediaHost(config)?.publicUrl(item.mediaKey)) ?? undefined) : undefined;
      const ids = await createBufferUpdate(item, config, publicUrl);
      await queue.recordBufferSuccess(item, { status: "scheduled", updateIds: ids }, now);
      record(
        "scheduled",
        `Buffer scheduled ${ids.length} update(s) for ${formatInTimezone(new Date(item.publishAt), config.timezone)}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = isTransient(error);
      await queue.recordBufferFailure(item, { message, transient }, now);
      const failed = item.buffer?.status === "failed";
      record(failed ? "failed" : "retrying", failed ? message : `${message} (will retry)`);
    }
  }

  return outcomes;
}
