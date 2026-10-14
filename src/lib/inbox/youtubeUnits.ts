import { updateInbox } from "@/lib/inbox/store";
import type { InboxStore } from "@/lib/inbox/types";
import { dateTimeFormat } from "@/lib/publisher/intl";

export const DEFAULT_YOUTUBE_DAILY_UNITS = 200;
export const YOUTUBE_REPLY_UNITS = 50;

const QUOTA_TIMEZONE = "America/Los_Angeles";

export function youtubeDailyUnits(): number {
  const raw = process.env.INBOX_YOUTUBE_DAILY_UNITS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_YOUTUBE_DAILY_UNITS;
}

export function quotaDay(now: Date): string {
  return dateTimeFormat("en-CA", { timeZone: QUOTA_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function youtubeUnitsToday(store: InboxStore, now: Date): number {
  return store.youtubeUnits?.date === quotaDay(now) ? store.youtubeUnits.used : 0;
}

export async function reserveYoutubeUnits(now: Date, units: number, cap: number): Promise<boolean> {
  let reserved = false;
  await updateInbox((current) => {
    const used = youtubeUnitsToday(current, now);
    if (used + units > cap) return current;
    reserved = true;
    return { ...current, youtubeUnits: { date: quotaDay(now), used: used + units } };
  });
  return reserved;
}

export async function chargeYoutubeUnits(now: Date, units: number): Promise<void> {
  await updateInbox((current) => ({
    ...current,
    youtubeUnits: { date: quotaDay(now), used: youtubeUnitsToday(current, now) + units }
  }));
}
