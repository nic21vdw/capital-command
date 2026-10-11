import type { Carousel, CarouselSchedule } from "@/types/domain";
import { publishZoneLabel } from "@/lib/carousels/booked";
import { formatClockTime } from "@/lib/timeFormat";

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
 * Networks the publisher really posts a picture carousel to
 * (`enqueueImagePost`). TikTok photo posts need an audited scope this app does
 * not have and YouTube has no picture API at all, so both are "manual": the
 * schedule is a reminder to post the slides by hand. Mirrors
 * `IMAGE_CAPABLE_PLATFORMS` in `lib/publisher/images.ts`, which this
 * client-safe module cannot import.
 */
export const IMAGE_CAPABLE_PLATFORMS: CarouselPlatformId[] = ["instagram", "facebook"];

/** The pair a new schedule starts with: the two networks that really post. */
export const DEFAULT_CAROUSEL_PLATFORMS: CarouselPlatformId[] = ["instagram", "facebook"];

/**
 * Which accounts are signed in, by network. `undefined` for a network means the
 * answer is not known yet (still loading, or the check failed), which must not
 * read as "not connected".
 */
export type PlatformConnectionMap = Partial<Record<CarouselPlatformId, boolean>>;

/**
 * One word for what scheduling to a network does, shown next to its button.
 * "reminder" is a network the publisher COULD post to but has no sign-in for:
 * the queue saves it as manual, so promising "Automatic" there is a lie.
 */
export function platformPostingMode(
  platform: CarouselPlatformId,
  connected?: PlatformConnectionMap
): "automatic" | "reminder" | "manual" {
  if (!IMAGE_CAPABLE_PLATFORMS.includes(platform)) return "manual";
  return connected?.[platform] === false ? "reminder" : "automatic";
}

/**
 * The words on a network's tile for each posting mode. The enum value stays
 * "manual" (the queue and the tests speak it); the owner reads what actually
 * happens: nothing posts, a reminder is saved.
 */
export const PLATFORM_MODE_LABELS = {
  automatic: "Automatic",
  reminder: "Not connected - saved as a reminder",
  manual: "Reminder only"
} as const;

/**
 * Whether a one-off booking can really post itself: at least one selected
 * network is image-capable and not known to be disconnected.
 */
export function anyPlatformPostsItself(platforms: CarouselPlatformId[], connected?: PlatformConnectionMap): boolean {
  return platforms.some((id) => platformPostingMode(id, connected) === "automatic");
}

/**
 * Did the booking route leave any network for the owner to post by hand? The
 * queue marks a network "manual" when it has no sign-in, so this reads the
 * statuses the route returned instead of the message text.
 */
export function bookingNeedsHands(statuses: Partial<Record<CarouselPlatformId, string>>): boolean {
  return Object.values(statuses).some((status) => status === "manual");
}

/**
 * Once a deck is in the publish queue it cannot be booked again, so both
 * networks that take a picture post are closed to a new action: the ones it is
 * booked on show their slot, the other says where to change it. What is left to
 * choose is the reminder-only networks.
 */
export function platformsClosedByBooking(booked: boolean): CarouselPlatformId[] {
  return booked ? [...IMAGE_CAPABLE_PLATFORMS] : [];
}

/** The picks that still mean something: a booked deck drops the closed networks. */
export function activePlatformPicks(picks: CarouselPlatformId[], booked: boolean): CarouselPlatformId[] {
  const closed = platformsClosedByBooking(booked);
  return picks.filter((id) => !closed.includes(id));
}

/**
 * The form's last button. On a booked deck there is nothing to save until a
 * reminder network is picked, so the footer is just Close and the link to the
 * booking; everywhere else Cancel and the save button stay.
 */
export function scheduleFooterMode(booked: boolean, picks: CarouselPlatformId[]): "save" | "close-only" {
  return booked && activePlatformPicks(picks, booked).length === 0 ? "close-only" : "save";
}

/**
 * What saving the schedule form does. Only a one-off to Instagram/Facebook is a
 * real booking in the publish queue; a repeat, or a network the publisher
 * cannot post a picture to, stays a reminder saved on the carousel.
 */
export function planCarouselSchedule(
  platforms: CarouselPlatformId[],
  recurrence: CarouselSchedule["recurrence"]
): { book: CarouselPlatformId[]; remind: CarouselPlatformId[] } {
  const unique = platforms.filter((id, index) => platforms.indexOf(id) === index);
  if (recurrence !== "once") return { book: [], remind: unique };
  return {
    book: unique.filter((id) => IMAGE_CAPABLE_PLATFORMS.includes(id)),
    remind: unique.filter((id) => !IMAGE_CAPABLE_PLATFORMS.includes(id))
  };
}

/**
 * "Tue 3:00 PM" for an instant, as seen in the publish timezone - "Tue 3:00 PM
 * EDT" when the viewer's browser is in another zone, so the time is not taken
 * for their own clock.
 */
export function bookingTimeLabel(publishAt: string, timeZone: string, viewerZone?: string | null): string {
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return publishAt;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit"
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const zone = publishZoneLabel(publishAt, timeZone, viewerZone);
    return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}${zone ? ` ${zone}` : ""}`.trim();
  } catch {
    return publishAt;
  }
}

/**
 * The toast for a booking the publisher accepted, from the per-platform
 * statuses the booking route returns. A platform that is not connected is saved
 * as "manual" by the queue, and saying "Booked" for it would be the same lie
 * the old "Upload scheduled." was.
 */
export function bookingMessage(
  statuses: Partial<Record<CarouselPlatformId, string>>,
  publishAt: string,
  timeZone: string,
  viewerZone?: string | null
): string {
  const when = bookingTimeLabel(publishAt, timeZone, viewerZone);
  const names = (ids: CarouselPlatformId[]) => {
    const labels = ids.map((id) => PLATFORM_LABEL[id]);
    return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : (labels[0] ?? "");
  };
  const entries = Object.entries(statuses) as [CarouselPlatformId, string][];
  const manual = entries.filter(([, status]) => status === "manual").map(([id]) => id);
  const booked = entries.filter(([, status]) => status !== "manual").map(([id]) => id);
  if (booked.length === 0) {
    return `Saved for ${when}, but ${names(manual)} ${manual.length > 1 ? "aren't" : "isn't"} connected - post the slides by hand.`;
  }
  const base = `Booked on ${names(booked)} for ${when}`;
  return manual.length > 0
    ? `${base}. ${names(manual)} ${manual.length > 1 ? "aren't" : "isn't"} connected - post those by hand.`
    : base;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function recurrenceLabel(schedule: CarouselSchedule): string {
  if (schedule.recurrence === "daily") return `Every day · ${formatClockTime(schedule.time)}`;
  if (schedule.recurrence === "weekly") return `Every ${WEEKDAY_LABELS[schedule.weekday ?? 0]} · ${formatClockTime(schedule.time)}`;
  return `${schedule.date} · ${formatClockTime(schedule.time)}`;
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
