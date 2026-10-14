import { dateTimeFormat } from "@/lib/publisher/intl";
import type { PublisherConfig } from "@/lib/publisher/config";
import type { QueueItem } from "@/lib/publisher/types";
import type { LedgerSnapshot, PurposeUnits, QuotaPurpose } from "@/lib/youtube/quotaLedger";

/**
 * YouTube Data API quota awareness for the Uploading Center meter and the
 * runner's daily allowance. Each videos.insert costs ~1600 units of the default
 * 10,000/day, so about six uploads fit. Every unit the app spends is debited in
 * the shared ledger (src/lib/youtube/quotaLedger.ts); this module only reads its
 * snapshot, in the quota's own reset window - YouTube resets at midnight Pacific
 * Time. The queue's uploadedAt stamps stay as the second opinion on how many
 * videos went up today.
 */

export const YOUTUBE_UNITS_PER_UPLOAD = 1600;
export const YOUTUBE_UPDATE_UNITS = 50;
export const YOUTUBE_READ_UNITS = 1;
export const YOUTUBE_DAILY_UNITS = 10_000;
const QUOTA_RESET_TIMEZONE = "America/Los_Angeles";

const SPLIT_ORDER: QuotaPurpose[] = ["upload", "analytics", "inbox", "inbox-reply", "listening", "outliers", "stats", "schedule", "ingest", "channel"];

export type QuotaSplitEntry = { purpose: QuotaPurpose; units: number; cap?: number };

export type YoutubeQuota = {
  /** Calendar date (in the quota reset timezone) these numbers cover. */
  date: string;
  uploadsUsed: number;
  /** Pending YouTube uploads — the runner sends these as soon as it sees them. */
  uploadsPending: number;
  projectedUploads: number;
  budgetUploads: number;
  /** Uploads the day can still take: the smaller of the queue's count and what the ledger says is left. */
  remainingUploads: number;
  usedUnits: number;
  unitsPerUpload: number;
  dailyUnits: number;
  overBudget: boolean;
  /** What each purpose has spent today, from the ledger. */
  split: QuotaSplitEntry[];
  nonUploadAllowance: number;
  nonUploadSpent: number;
  /** False when the ledger could not be read and the numbers come from the queue alone. */
  ledgerReadable: boolean;
};

function ledgerFor(snapshot: LedgerSnapshot | null | undefined, now: Date): LedgerSnapshot | null {
  return snapshot && snapshot.day === quotaDate(now) ? snapshot : null;
}

function uploadsToday(items: QueueItem[], now: Date): { used: number; pending: number } {
  const today = quotaDate(now);
  let used = 0;
  let pending = 0;
  for (const item of items) {
    const state = item.platforms.youtube;
    if (!state) continue;
    if (state.uploadedAt && quotaDate(new Date(state.uploadedAt)) === today) used += 1;
    else if (state.status === "pending" || state.status === "uploaded") pending += 1;
  }
  return { used, pending };
}

/**
 * How many more videos may be uploaded to YouTube in the current quota day.
 *
 * The runner uploads a YouTube item as soon as it sees it — YouTube publishes it
 * natively at its slot — so a batch booked across three weeks still sends every
 * file TODAY. That is what emptied the daily allowance in one morning and locked
 * the channel out of uploading. The runner asks this before each fresh upload
 * and defers the rest to tomorrow; nothing is failed or lost.
 *
 * The ledger knows what the day has really spent, so an upload is only handed
 * out while it holds a whole upload's units. Its non-upload allowance is
 * reserved outside the upload budget, so it never takes a slot. The queue's
 * count still caps the answer: a ledger that lost the morning's uploads (a
 * deleted file, a first day after migrating) cannot hand the day out twice.
 */
export function remainingYoutubeUploads(items: QueueItem[], now: Date, config: PublisherConfig, ledger?: LedgerSnapshot | null): number {
  const queueLeft = Math.max(0, config.youtube.dailyUploadBudget - uploadsToday(items, now).used);
  const usable = ledgerFor(ledger, now);
  if (!usable) return queueLeft;
  const ledgerLeft = Math.floor(Math.max(0, usable.dailyUnits - usable.spent) / YOUTUBE_UNITS_PER_UPLOAD);
  return Math.min(queueLeft, ledgerLeft);
}

export function quotaDate(instant: Date): string {
  return dateTimeFormat("en-CA", {
    timeZone: QUOTA_RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
}

export function quotaMinuteOfDay(instant: Date): number {
  const parts = dateTimeFormat("en-US", { timeZone: QUOTA_RESET_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

function splitOf(ledger: LedgerSnapshot): QuotaSplitEntry[] {
  const byPurpose: PurposeUnits = ledger.byPurpose;
  const purposes = SPLIT_ORDER.filter((purpose) => purpose === "upload" || (byPurpose[purpose] ?? 0) > 0 || ledger.purposeCaps[purpose] !== undefined);
  return purposes.map((purpose) => {
    const cap = ledger.purposeCaps[purpose];
    return { purpose, units: byPurpose[purpose] ?? 0, ...(cap === undefined ? {} : { cap }) };
  });
}

export function youtubeQuota(items: QueueItem[], now: Date, config: PublisherConfig, ledger: LedgerSnapshot | null = null): YoutubeQuota {
  const { used: uploadsUsed, pending: uploadsPending } = uploadsToday(items, now);
  const projectedUploads = uploadsUsed + uploadsPending;
  const budget = config.youtube.dailyUploadBudget;
  const usable = ledgerFor(ledger, now);
  const queueUnits = uploadsUsed * YOUTUBE_UNITS_PER_UPLOAD;
  return {
    date: quotaDate(now),
    uploadsUsed,
    uploadsPending,
    projectedUploads,
    budgetUploads: budget,
    remainingUploads: remainingYoutubeUploads(items, now, config, usable),
    usedUnits: usable ? usable.spent : queueUnits,
    unitsPerUpload: YOUTUBE_UNITS_PER_UPLOAD,
    dailyUnits: YOUTUBE_DAILY_UNITS,
    overBudget: projectedUploads > budget,
    split: usable ? splitOf(usable) : [{ purpose: "upload", units: queueUnits }],
    nonUploadAllowance: usable?.nonUploadAllowance ?? 0,
    nonUploadSpent: usable?.nonUploadSpent ?? 0,
    ledgerReadable: usable !== null
  };
}
