import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * Which carousels are already in the publish queue, and how to say so.
 *
 * Nothing on a queue item names its carousel, but a booked deck is posted from
 * the files `renderCarouselDeck` writes to `data/carousels/<carouselId>/`, and
 * `enqueueImagePost` stores those paths (see `deckFiles.ts`). Reading the id
 * back out of them needs no new field, so it also covers every deck booked
 * before this existed and the ones the Stream Pipeline books by itself.
 *
 * Pure and client-safe: the page imports the types and the wording from here.
 */

/** A booking as the carousels page needs it. */
export type CarouselBooking = {
  /** The queue item, which the Uploading Center opens with `?item=`. */
  itemId: string;
  publishAt: string;
  platforms: PlatformId[];
  /** Every leg has gone out (or been handed to the network). */
  posted: boolean;
};

const DECK_SLIDE = /(?:^|\/)data\/carousels\/([^/]+)\/slide-\d+\.[a-z]+$/i;

/** The carousel a set of picture paths belongs to, or null for any other picture post. */
export function carouselIdFromImagePaths(paths: string[] | undefined): string | null {
  if (!paths || paths.length === 0) return null;
  const ids = new Set<string>();
  for (const entry of paths) {
    const match = DECK_SLIDE.exec(entry.replace(/\\/g, "/"));
    if (!match) return null;
    ids.add(match[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

function bookingOf(item: QueueItem): CarouselBooking {
  const legs = Object.entries(item.platforms) as Array<[PlatformId, { status: string } | undefined]>;
  return {
    itemId: item.id,
    publishAt: item.publishAt,
    platforms: legs.map(([id]) => id),
    posted: legs.length > 0 && legs.every(([, state]) => state?.status === "published" || state?.status === "uploaded")
  };
}

/**
 * One booking per carousel. A post whose every leg failed is not a booking (the
 * same rule the duplicate check uses: re-scheduling it is the point). When a
 * deck has been booked more than once, the next one still to go out wins, else
 * the most recent. Its platforms are everywhere the deck is booked, because
 * LinkedIn can be added to a deck as a post of its own.
 */
export function bookingsByCarousel(items: QueueItem[], now: Date = new Date()): Record<string, CarouselBooking> {
  const grouped = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (item.mediaKind !== "image") continue;
    const id = carouselIdFromImagePaths(item.imagePaths);
    if (!id) continue;
    const legs = Object.values(item.platforms);
    if (legs.length > 0 && legs.every((state) => state?.status === "failed")) continue;
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  const result: Record<string, CarouselBooking> = {};
  for (const [id, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    const upcoming = sorted.find((item) => new Date(item.publishAt).getTime() >= now.getTime());
    const chosen = bookingOf(upcoming ?? sorted[sorted.length - 1]);
    result[id] = { ...chosen, platforms: [...new Set(sorted.flatMap((item) => bookingOf(item).platforms))] };
  }
  return result;
}

/** The browser's own time zone, or null where it cannot be read (server, old engine). */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const WALL_CLOCK = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric"
  });

/**
 * "EDT" - the short zone name for an instant - but only when the viewer is
 * reading the slot in a DIFFERENT zone from the one it is booked in. A browser in
 * Toronto reading a Toronto slot needs no label; one in UTC would otherwise take
 * "12:30 PM" for its own clock. Zones are compared by what the clock reads at that
 * instant, so aliases (Etc/UTC and UTC, Toronto and New York) do not count as a
 * difference. `viewerZone` undefined reads the browser's; null means unknown.
 */
export function publishZoneLabel(publishAt: string, timeZone: string, viewerZone?: string | null): string {
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return "";
  const viewer = viewerZone === undefined ? browserTimeZone() : viewerZone;
  if (!viewer) return "";
  try {
    if (WALL_CLOCK(viewer).format(date) === WALL_CLOCK(timeZone).format(date)) return "";
    const named = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date);
    return named.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function zonedParts(publishAt: string, timeZone: string, viewerZone?: string | null) {
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const zone = publishZoneLabel(publishAt, timeZone, viewerZone);
    return {
      day: `${get("weekday")}, ${get("month")} ${get("day")}`,
      time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}${zone ? ` ${zone}` : ""}`.trim()
    };
  } catch {
    return null;
  }
}

/** "Tue, Oct 13, 12:30 PM" in the publish time zone, plus "EDT" when the viewer is in another. */
export function bookedWhen(publishAt: string, timeZone: string, viewerZone?: string | null): string {
  const parts = zonedParts(publishAt, timeZone, viewerZone);
  return parts ? `${parts.day}, ${parts.time}` : publishAt;
}

/** "Tue, Oct 13 at 12:30 PM" - the form that reads inside a sentence. */
export function bookedWhenInSentence(publishAt: string, timeZone: string, viewerZone?: string | null): string {
  const parts = zonedParts(publishAt, timeZone, viewerZone);
  return parts ? `${parts.day} at ${parts.time}` : publishAt;
}

const LABELS: Partial<Record<PlatformId, string>> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn"
};

/** "Instagram + Facebook". */
export function bookedPlatformsLabel(platforms: PlatformId[]): string {
  return platforms.map((id) => LABELS[id] ?? id).join(" + ");
}

/** "Booked Tue, Oct 13, 12:30 PM · Instagram + Facebook" (or "Posted ..."). */
export function bookedChipText(booking: CarouselBooking, timeZone: string, viewerZone?: string | null): string {
  const platforms = bookedPlatformsLabel(booking.platforms);
  return `${booking.posted ? "Posted" : "Booked"} ${bookedWhen(booking.publishAt, timeZone, viewerZone)}${platforms ? ` · ${platforms}` : ""}`;
}

/** The plain-words refusal for a second booking of the same deck. */
export function alreadyBookedMessage(publishAt: string | undefined, timeZone: string, viewerZone?: string | null): string {
  return publishAt
    ? `This carousel is already booked for ${bookedWhenInSentence(publishAt, timeZone, viewerZone)}.`
    : "This carousel is already booked.";
}

/**
 * What a platform button says once the deck is booked on it: "Booked Tue, Oct 13,
 * 12:30 PM" (or "Posted ..."), without the platform list the chip carries.
 */
export function bookedPlatformStatus(booking: CarouselBooking, timeZone: string, viewerZone?: string | null): string {
  return `${booking.posted ? "Posted" : "Booked"} ${bookedWhen(booking.publishAt, timeZone, viewerZone)}`;
}
