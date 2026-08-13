import { dateTimeFormat } from "@/lib/publisher/intl";
import { fitToThreads } from "@/lib/threads/plan";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";

// Posts that did not come from the daily pack — today, the text posts a stream
// produced. They ride the same queue and the same runner, and are marked
// `origin: "pipeline"` so the autopilot's "is this day planned?" check cannot
// see them and skip writing the day's batch.

const HOUR = 60 * 60 * 1000;

export type AdhocPlanInput = {
  texts: string[];
  config: ThreadsConfig;
  now: Date;
  /** Instants already spoken for, so two posts never land on the same minute. */
  taken: Set<string>;
  runId?: string;
  /** Hours between one ad-hoc post and the next. */
  spacingHours?: number;
  /** How long after now the first one goes out. */
  leadHours?: number;
  newId?: () => string;
};

/**
 * Lays the posts out from one account only. Two connected accounts posting the
 * same wording reads as mirrored spam — the daily pack avoids that by writing a
 * separate version per account, and a stream's post has only the one.
 */
export function planAdhocPosts({
  texts,
  config,
  now,
  taken,
  runId,
  spacingHours = 4,
  leadHours = 2,
  newId
}: AdhocPlanInput): ThreadsQueueItem[] {
  const account = config.accounts[0];
  if (!account || texts.length === 0) return [];
  const nextId = newId ?? (() => `thread-${crypto.randomUUID()}`);
  const createdAt = now.toISOString();

  const items: ThreadsQueueItem[] = [];
  let at = new Date(now.getTime() + leadHours * HOUR);
  for (const raw of texts) {
    const text = fitToThreads(raw.trim());
    if (!text) continue;
    while (taken.has(at.toISOString())) at = new Date(at.getTime() + spacingHours * HOUR);
    const publishAt = at.toISOString();
    taken.add(publishAt);
    items.push({
      id: nextId(),
      batchDate: localDateKey(at, config.timezone),
      // Slot 0 marks a post that is not one of the day's numbered slots, so a
      // catch-up pass can never mistake it for a pack post that fell behind.
      slot: 0,
      accountId: account.id,
      version: account.posts,
      topic: runId ? "From a stream" : "Ad hoc",
      format: "stream",
      text,
      publishAt,
      status: "pending",
      attempts: 0,
      createdAt,
      origin: "pipeline",
      ...(runId ? { sourceRunId: runId } : {})
    });
    at = new Date(at.getTime() + spacingHours * HOUR);
  }
  return items;
}

function localDateKey(instant: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}
