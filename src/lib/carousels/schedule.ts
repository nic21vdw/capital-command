import type { Carousel, CarouselSchedule } from "@/types/domain";

/** The four networks a carousel can be scheduled to, in display order. */
export const CAROUSEL_PLATFORMS = [
  { id: "instagram", label: "Instagram", short: "IG", color: "#e1306c" },
  { id: "facebook", label: "Facebook", short: "FB", color: "#1877f2" },
  { id: "tiktok", label: "TikTok", short: "TT", color: "#25f4ee" },
  { id: "youtube", label: "YouTube", short: "YT", color: "#ff0000" }
] as const;

export type CarouselPlatformId = (typeof CAROUSEL_PLATFORMS)[number]["id"];

export const PLATFORM_LABEL: Record<CarouselPlatformId, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube"
};

/**
 * Networks that can carry an image carousel natively (once the matching
 * publisher image adapter is wired). YouTube only takes video, so a carousel
 * scheduled there is tracked as a manual reminder — surfaced in the UI.
 */
export const IMAGE_CAPABLE_PLATFORMS: CarouselPlatformId[] = ["instagram", "facebook", "tiktok"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function recurrenceLabel(schedule: CarouselSchedule): string {
  if (schedule.recurrence === "daily") return `Every day · ${schedule.time}`;
  if (schedule.recurrence === "weekly") return `Every ${WEEKDAY_LABELS[schedule.weekday ?? 0]} · ${schedule.time}`;
  return `${schedule.date} · ${schedule.time}`;
}

export type ScheduleOccurrence = {
  scheduleId: string;
  carouselId: string;
  carouselTitle: string;
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  time: string;
  platforms: CarouselPlatformId[];
  caption?: string;
  recurrence: CarouselSchedule["recurrence"];
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses a "YYYY-MM-DD" string into a local Date at midnight. */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Expands every schedule on every carousel into concrete calendar
 * occurrences across a forward window (default 28 days from `from`).
 */
export function expandOccurrences(carousels: Carousel[], from: Date, days = 28): ScheduleOccurrence[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const occurrences: ScheduleOccurrence[] = [];

  for (const carousel of carousels) {
    for (const schedule of carousel.schedules ?? []) {
      const platforms = schedule.platforms as CarouselPlatformId[];
      const base = {
        scheduleId: schedule.id,
        carouselId: carousel.id,
        carouselTitle: carousel.title,
        time: schedule.time,
        platforms,
        caption: schedule.caption,
        recurrence: schedule.recurrence
      };

      if (schedule.recurrence === "once") {
        const day = parseDateKey(schedule.date);
        if (day >= start) occurrences.push({ ...base, dateKey: schedule.date });
        continue;
      }

      const anchor = parseDateKey(schedule.date);
      for (let offset = 0; offset < days; offset += 1) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
        if (day < anchor) continue;
        if (schedule.recurrence === "weekly" && day.getDay() !== (schedule.weekday ?? anchor.getDay())) continue;
        occurrences.push({ ...base, dateKey: toDateKey(day) });
      }
    }
  }

  return occurrences.sort((a, b) => (a.dateKey === b.dateKey ? a.time.localeCompare(b.time) : a.dateKey.localeCompare(b.dateKey)));
}

export { toDateKey, parseDateKey, WEEKDAY_LABELS };
