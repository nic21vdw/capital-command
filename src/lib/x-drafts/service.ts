import { localCalendarParts } from "@/lib/publisher/time";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { mutateQueue } from "@/lib/threads/queue";
import { hasStarted } from "@/lib/threads/rewrite";
import { xDraftsConfig, type XDraftsConfig } from "@/lib/x-drafts/config";
import { writeDraftBatch } from "@/lib/x-drafts/generator";
import { newPhoneKey, renderPhonePage, uploadPhonePage } from "@/lib/x-drafts/phone";
import { addDays, bookDraftsOnThreads, datesDue, nextUnwrittenDate, slotTimes } from "@/lib/x-drafts/schedule";
import { xDraftsStore } from "@/lib/x-drafts/store";
import { X_EXAMPLES } from "@/lib/x-drafts/voice";
import type { XDraft, XDraftsState } from "@/lib/x-drafts/types";

const KEEP_DAYS = 14;
const MINUTE = 60_000;

type Flight = { date: string; promise: Promise<WriteOutcome> };
const holder = globalThis as typeof globalThis & { __xDraftsFlight?: Flight | null };

export type WriteOutcome = { date: string; created: number; booked: number; dropped: string[]; error?: string };

export function writingNow(): string | null {
  return holder.__xDraftsFlight?.date ?? null;
}

function recentOpenings(state: XDraftsState): string[] {
  const own = [...state.drafts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((draft) => draft.text.split("\n")[0] ?? "");
  return [...own, ...X_EXAMPLES.map((example) => example.split("\n")[0] ?? "")].filter(Boolean);
}

function prune(drafts: XDraft[], today: string): XDraft[] {
  const cutoff = addDays(today, -KEEP_DAYS);
  return drafts.filter((draft) => draft.batchDate >= cutoff);
}

async function runWrite(date: string, now: Date, threads: ThreadsConfig, config: XDraftsConfig): Promise<WriteOutcome> {
  const state = await xDraftsStore.read();
  if (state.drafts.some((draft) => draft.batchDate === date)) return { date, created: 0, booked: 0, dropped: [] };
  let drafts: XDraft[] = [];
  let dropped: string[] = [];
  let error: string | undefined;
  try {
    ({ drafts, dropped } = await writeDraftBatch({ date, times: slotTimes(config), recentOpenings: recentOpenings(state), now }));
    if (drafts.length === 0) error = `No usable drafts came back${dropped.length ? ` (${dropped.slice(0, 3).join("; ")})` : ""}.`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  let booked = 0;
  if (drafts.length && config.threads) {
    const booking = await mutateQueue((items) => {
      const result = bookDraftsOnThreads({ drafts, queue: items, threads, config, now: new Date() });
      return { items: [...items, ...result.items], result };
    });
    booked = booking.booked.length;
    drafts = drafts.map((draft) => {
      const hit = booking.booked.find((entry) => entry.draftId === draft.id);
      const note = booking.notes.find((entry) => entry.draftId === draft.id)?.note;
      return hit ? { ...draft, threadsItemId: hit.itemId, threadsAt: hit.at } : note ? { ...draft, threadsNote: note } : draft;
    });
  } else if (drafts.length) {
    drafts = drafts.map((draft) => ({ ...draft, threadsNote: "Threads booking is switched off (X_DRAFTS_THREADS=off)." }));
  }

  const today = localCalendarParts(now, threads.timezone).dateKey;
  await xDraftsStore.update((current) => ({
    ...current,
    drafts: prune([...current.drafts.filter((draft) => draft.batchDate !== date || drafts.length === 0), ...drafts], today),
    lastWrite: { at: new Date().toISOString(), date, created: drafts.length, ...(error ? { error } : {}) }
  }));
  if (drafts.length) await refreshPhonePage(now, threads.timezone);
  return { date, created: drafts.length, booked, dropped, ...(error ? { error } : {}) };
}

export function writeDraftsFor(
  date: string,
  options: { now?: Date; threads?: ThreadsConfig; config?: XDraftsConfig } = {}
): Promise<WriteOutcome> {
  const flight = holder.__xDraftsFlight;
  if (flight) return flight.promise;
  const promise = runWrite(date, options.now ?? new Date(), options.threads ?? threadsConfig(), options.config ?? xDraftsConfig()).finally(() => {
    holder.__xDraftsFlight = null;
  });
  holder.__xDraftsFlight = { date, promise };
  return promise;
}

export async function nextDateToWrite(now = new Date(), timeZone = threadsConfig().timezone): Promise<string | null> {
  return nextUnwrittenDate(await xDraftsStore.read(), now, timeZone, xDraftsConfig());
}

export function shouldRetry(state: XDraftsState, date: string, now: Date, config: XDraftsConfig): boolean {
  const last = state.lastWrite;
  if (!last || last.date !== date || !last.error) return true;
  return now.getTime() - Date.parse(last.at) >= config.retryAfterMinutes * MINUTE;
}

export function ensureXDraftsInBackground(options: { threads: ThreadsConfig; now: Date; log?: (line: string) => void }): void {
  const config = xDraftsConfig();
  if (!config.enabled || writingNow()) return;
  void (async () => {
    const state = await xDraftsStore.read();
    const due = datesDue(state, options.now, options.threads.timezone, config).filter((date) => shouldRetry(state, date, options.now, config));
    for (const date of due) {
      const outcome = await writeDraftsFor(date, { now: options.now, threads: options.threads, config });
      options.log?.(`[x-drafts] ${date}: ${outcome.created} drafts, ${outcome.booked} on Threads${outcome.error ? `, ${outcome.error}` : ""}`);
      if (outcome.error) break;
    }
  })().catch((error) => options.log?.(`[x-drafts] ${error instanceof Error ? error.message : String(error)}`));
}

export async function refreshPhonePage(now = new Date(), timeZone = threadsConfig().timezone): Promise<XDraftsState["phonePage"]> {
  let key: string | undefined;
  await xDraftsStore.update((current) => {
    key = current.phoneKey ?? newPhoneKey();
    return current.phoneKey ? current : { ...current, phoneKey: key };
  });
  const state = await xDraftsStore.read();
  const html = renderPhonePage(state, { today: localCalendarParts(now, timeZone).dateKey, timeZone, generatedAt: now });
  const outcome = await uploadPhonePage(key!, html);
  const phonePage = { at: new Date().toISOString(), ...outcome };
  await xDraftsStore.update((current) => ({ ...current, phonePage }));
  return phonePage;
}

export type StatusChange = { ok: true; draft: XDraft; threads?: "stopped" | "already-sent" | "not-booked" } | { ok: false; error: string };

export async function setDraftStatus(id: string, status: "posted-x" | "dismissed" | "new", now = new Date()): Promise<StatusChange> {
  let found: XDraft | undefined;
  await xDraftsStore.update((current) => ({
    ...current,
    drafts: current.drafts.map((draft) => {
      if (draft.id !== id) return draft;
      const next: XDraft = { ...draft, status };
      if (status === "posted-x") next.postedXAt = now.toISOString();
      if (status === "dismissed") next.dismissedAt = now.toISOString();
      if (status === "new") {
        delete next.postedXAt;
        delete next.dismissedAt;
      }
      found = next;
      return next;
    })
  }));
  if (!found) return { ok: false, error: "No such draft." };
  let threads: "stopped" | "already-sent" | "not-booked" | undefined;
  if (status === "dismissed") {
    const itemId = found.threadsItemId;
    if (!itemId) threads = "not-booked";
    else {
      threads = await mutateQueue((items) => {
        const item = items.find((entry) => entry.id === itemId);
        if (!item || item.status !== "pending") return { items, result: item?.status === "published" ? "already-sent" as const : "not-booked" as const };
        if (hasStarted(item)) return { items, result: "already-sent" as const };
        item.status = "skipped";
        item.note = "Dismissed from X Drafts.";
        delete item.claimedAt;
        return { items, result: "stopped" as const };
      });
    }
  }
  await refreshPhonePage(now).catch(() => undefined);
  return { ok: true, draft: found, ...(threads ? { threads } : {}) };
}
