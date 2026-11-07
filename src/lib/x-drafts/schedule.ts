import { localCalendarParts, zonedToUtc } from "@/lib/publisher/time";
import { fitToThreads } from "@/lib/threads/plan";
import { plugReplyFor } from "@/lib/threads/plug";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { XDraftsConfig } from "@/lib/x-drafts/config";
import type { XDraft, XDraftsState } from "@/lib/x-drafts/types";

const MINUTE = 60_000;

function hhmm(total: number): string {
  const minutes = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function slotTimes(config: Pick<XDraftsConfig, "perDay" | "firstSlotMinutes" | "gapMinutes">): string[] {
  const times: string[] = [];
  for (let index = 0; index < config.perDay; index += 1) {
    const total = config.firstSlotMinutes + index * config.gapMinutes;
    if (total >= 1440) break;
    times.push(hhmm(total));
  }
  return times;
}

export function localInstant(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return zonedToUtc(timeZone, y, mo, d, h, mi, 0);
}

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function threadsInstant(draft: Pick<XDraft, "id" | "batchDate" | "time">, timeZone: string, offsetMinutes: number): Date {
  const jitter = (hash32(draft.id) % 17) - 8;
  return new Date(localInstant(draft.batchDate, draft.time, timeZone).getTime() + (offsetMinutes + jitter) * MINUTE);
}

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function writtenDates(state: XDraftsState): Set<string> {
  return new Set(state.drafts.map((draft) => draft.batchDate));
}

export function datesDue(state: XDraftsState, now: Date, timeZone: string, config: XDraftsConfig): string[] {
  const { dateKey: today, time } = localCalendarParts(now, timeZone);
  const written = writtenDates(state);
  const due: string[] = [];
  const times = slotTimes(config);
  const lastSlot = times[times.length - 1] ?? "00:00";
  if (!written.has(today) && time < lastSlot) due.push(today);
  const hour = Number(time.slice(0, 2));
  const tomorrow = addDays(today, 1);
  if (hour >= config.writeAheadHour && !written.has(tomorrow)) due.push(tomorrow);
  return due;
}

export function nextUnwrittenDate(state: XDraftsState, now: Date, timeZone: string, config: XDraftsConfig): string | null {
  const { dateKey: today, time } = localCalendarParts(now, timeZone);
  const written = writtenDates(state);
  const times = slotTimes(config);
  const lastSlot = times[times.length - 1] ?? "00:00";
  for (let offset = 0; offset <= config.maxDaysAhead; offset += 1) {
    if (offset === 0 && time >= lastSlot) continue;
    const date = addDays(today, offset);
    if (!written.has(date)) return date;
  }
  return null;
}

export type ThreadsBooking = {
  items: ThreadsQueueItem[];
  booked: Array<{ draftId: string; itemId: string; at: string }>;
  notes: Array<{ draftId: string; note: string }>;
};

export function bookDraftsOnThreads(input: {
  drafts: XDraft[];
  queue: ThreadsQueueItem[];
  threads: ThreadsConfig;
  config: XDraftsConfig;
  now: Date;
  newId?: () => string;
}): ThreadsBooking {
  const nextId = input.newId ?? (() => `thread-${crypto.randomUUID()}`);
  const result: ThreadsBooking = { items: [], booked: [], notes: [] };
  const account = input.threads.accounts[0];
  const taken = new Set(input.queue.map((item) => item.publishAt));
  const alreadyQueued = new Set(input.queue.filter((item) => item.status !== "skipped").map((item) => item.text.trim()));
  const earliest = input.now.getTime() + input.config.minLeadMinutes * MINUTE;
  for (const draft of input.drafts) {
    if (draft.threadsItemId || draft.status === "dismissed") continue;
    if (!account) {
      result.notes.push({ draftId: draft.id, note: "No Threads account is connected." });
      continue;
    }
    const text = fitToThreads(draft.text);
    if (!text || text.length < draft.text.trim().length - 5) {
      result.notes.push({ draftId: draft.id, note: "Too long for Threads, so it stays X only." });
      continue;
    }
    if (alreadyQueued.has(text)) {
      result.notes.push({ draftId: draft.id, note: "Already on the Threads queue." });
      continue;
    }
    let at = threadsInstant(draft, input.threads.timezone, input.config.threadsOffsetMinutes);
    if (at.getTime() < earliest) {
      result.notes.push({ draftId: draft.id, note: "Its Threads time had already passed when it was written." });
      continue;
    }
    while (taken.has(at.toISOString())) at = new Date(at.getTime() + MINUTE);
    const publishAt = at.toISOString();
    taken.add(publishAt);
    alreadyQueued.add(text);
    const id = nextId();
    const plugText = plugReplyFor(text, id, input.threads, "pipeline");
    result.items.push({
      id,
      batchDate: localCalendarParts(at, input.threads.timezone).dateKey,
      slot: 0,
      accountId: account.id,
      version: account.posts,
      topic: `X draft: ${draft.topic}`,
      format: "x-draft",
      text,
      publishAt,
      status: "pending",
      ...(plugText ? { plugText } : {}),
      attempts: 0,
      createdAt: input.now.toISOString(),
      origin: "pipeline",
      sourceDraftId: draft.id
    });
    result.booked.push({ draftId: draft.id, itemId: id, at: publishAt });
  }
  return result;
}
