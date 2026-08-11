import type { PublisherConfig } from "@/lib/publisher/config";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * YouTube Data API quota awareness for the Uploading Center meter. Each
 * videos.insert costs ~1600 units of the default 10,000/day, so about six
 * uploads fit. Usage is counted from the queue's uploadedAt stamps in the
 * quota's own reset window — YouTube resets at midnight Pacific Time.
 */

export const YOUTUBE_UNITS_PER_UPLOAD = 1600;
export const YOUTUBE_DAILY_UNITS = 10_000;
const QUOTA_RESET_TIMEZONE = "America/Los_Angeles";

export type YoutubeQuota = {
  /** Calendar date (in the quota reset timezone) these numbers cover. */
  date: string;
  uploadsUsed: number;
  /** Pending YouTube uploads — the runner sends these as soon as it sees them. */
  uploadsPending: number;
  projectedUploads: number;
  budgetUploads: number;
  usedUnits: number;
  unitsPerUpload: number;
  dailyUnits: number;
  overBudget: boolean;
};

/**
 * How many more videos may be uploaded to YouTube in the current quota day.
 *
 * The runner uploads a YouTube item as soon as it sees it — YouTube publishes it
 * natively at its slot — so a batch booked across three weeks still sends every
 * file TODAY. That is what emptied the daily allowance in one morning and locked
 * the channel out of uploading. The runner asks this before each fresh upload
 * and defers the rest to tomorrow; nothing is failed or lost.
 */
export function remainingYoutubeUploads(items: QueueItem[], now: Date, config: PublisherConfig): number {
  const { uploadsUsed } = youtubeQuota(items, now, config);
  return Math.max(0, config.youtube.dailyUploadBudget - uploadsUsed);
}

function quotaDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: QUOTA_RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
}

export function youtubeQuota(items: QueueItem[], now: Date, config: PublisherConfig): YoutubeQuota {
  const today = quotaDate(now);
  let uploadsUsed = 0;
  let uploadsPending = 0;
  for (const item of items) {
    const state = item.platforms.youtube;
    if (!state) continue;
    if (state.uploadedAt && quotaDate(new Date(state.uploadedAt)) === today) uploadsUsed += 1;
    else if (state.status === "pending" || state.status === "uploaded") uploadsPending += 1;
  }
  const projectedUploads = uploadsUsed + uploadsPending;
  return {
    date: today,
    uploadsUsed,
    uploadsPending,
    projectedUploads,
    budgetUploads: config.youtube.dailyUploadBudget,
    usedUnits: uploadsUsed * YOUTUBE_UNITS_PER_UPLOAD,
    unitsPerUpload: YOUTUBE_UNITS_PER_UPLOAD,
    dailyUnits: YOUTUBE_DAILY_UNITS,
    overBudget: projectedUploads > config.youtube.dailyUploadBudget
  };
}
