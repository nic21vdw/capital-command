/**
 * The Master Calendar's unified event model. Every distribution surface —
 * scheduled shorts uploads (publish queue), carousel upload schedules,
 * Threads daily packs, FB/IG thread posts and the dated content tracker —
 * is flattened into MasterCalendarEvent so one calendar can render them all
 * side by side and link back to the calendar that owns each item.
 */

import { OVERDUE_LABEL, SHOULD_BE_LIVE_LABEL } from "@/lib/publisher/nativeScheduling";
import type { YoutubeStat } from "@/lib/publisher/youtubeStatsShared";
import { SCHEDULED_WORD } from "@/lib/statusTone";

export type CalendarSourceId = "shorts" | "carousels" | "queued-carousels" | "x" | "fb" | "content";

export type MasterCalendarEvent = {
  /** Unique across the whole calendar (source-prefixed). */
  id: string;
  source: CalendarSourceId;
  /** Local calendar date, YYYY-MM-DD (publish timezone for queue items). */
  dateKey: string;
  /** Local wall-clock HH:mm; absent for day-level items (FB/IG, content). */
  time?: string;
  title: string;
  /** Display labels of the networks this event targets. */
  platforms: string[];
  /**
   * Source-native status, lowercased: published/scheduled/queued/failed/
   * "partly failed" for shorts, draft/posted for FB/IG, planned (pack only) or
   * the Threads queue's own outcome (queued/published/failed/skipped) for
   * Threads, the content tracker's pipeline stages, and "scheduled" for
   * carousel occurrences. A queue post past its slot reads "should be live"
   * (a platform holds it), "overdue" (the publisher has not sent it) or "needs connection" (the account has no connection). Before its slot, a
   * pending leg on an unconnected account reads "awaiting connection".
   */
  status: string;
  /** True for occurrences expanded from a repeating carousel schedule. */
  recurring?: boolean;
  /**
   * A poster frame cut from the real file, where one exists: the clip's own
   * frame for a queued short, the first slide for a queued picture post. What
   * makes a day read as content rather than as a list of titles.
   */
  thumbnailUrl?: string;
  /** Deep link into the screen that owns this item. Falls back to the source href. */
  href?: string;
  /** Display labels of the platforms whose leg failed. Absent when nothing failed. */
  failedPlatforms?: string[];
  /**
   * Why each failed leg failed, in one plain sentence, and the Uploading Center
   * card on that platform's tab where it is fixed. Parallel to `failedPlatforms`
   * (same order); absent for sources that carry no per-leg error.
   */
  failures?: {
    platform: string;
    reason: string;
    href: string;
    /** What the link says when it is not the Uploading Center ("Fix in Threads Autopilot"). */
    fixLabel?: string;
  }[];
  /**
   * A long-form upload that goes up private and stays private until it is made
   * public by hand after review. Without this it reads like any other booked post.
   */
  heldForReview?: boolean;
  /**
   * Platforms with nobody to post for them: the post is tracked as a reminder
   * and must be posted by hand. `href` is that platform's card in the Uploading
   * Center; `fileUrl` is the rendered picture, when the item exposes one.
   */
  manual?: { platform: string; href: string; fileUrl?: string }[];
  /** "Open on <platform>" links for legs that are live and whose URL shape is known. */
  liveLinks?: { platform: string; url: string }[];
  /**
   * The published YouTube video behind this post, when there is one. It is how
   * the Day Summary asks /api/publish/youtube-stats for its numbers; the queue
   * item id lets the server pick the right channel.
   */
  youtube?: { itemId: string; videoId: string };
  /**
   * What happened on each platform, for events that come from the publish
   * queue (the event's own `status` is one roll-up of these). `status` is the
   * queue's per-platform status as stored: pending, uploaded, scheduled,
   * published, failed or manual. `url` is the live post, when its shape is known;
   * `href` is that platform's own card in the app, so a row for Instagram never
   * opens the TikTok tab.
   */
  legs?: {
    platform: string;
    status: string;
    url?: string;
    href?: string;
    /**
     * Set when this leg's slot has passed without the usual ending (see
     * pastSlotMarker): a platform-held post that should be live by now, or a
     * pending one the publisher has not sent. `status` stays as stored.
     */
    late?: LateKind;
    /**
     * Set on a pending leg whose account has no connection while its slot is
     * still ahead (see `awaitingConnection`): not late, but it cannot go out on
     * its own, which is what the Uploading Center says as "Needs <Platform>
     * connection". Never set together with `late`.
     */
    awaitingConnection?: true;
    awaitingApproval?: true;
  }[];
};

/**
 * Why a leg or a post is past its slot: the platform should have published it,
 * the publisher has not sent it, or it never could because the account it posts
 * to has no connection (the Uploading Center's "Needs <Platform> connection").
 */
export type LateKind = "should-be-live" | "overdue" | "needs-connection";

/** The roll-up statuses for a queue post that is past its slot (additive: every other status is unchanged). */
export const SHOULD_BE_LIVE_STATUS = "should be live";
export const OVERDUE_STATUS = "overdue";
export const NEEDS_CONNECTION_STATUS = "needs connection";
/**
 * The roll-up for a post whose slot is still ahead but which has a pending leg
 * on an account with no connection. Not late (`isLateEventStatus` is false), but
 * flagged: it reads the same as the Uploading Center's "Needs <Platform>
 * connection" instead of "queued".
 */
export const AWAITING_CONNECTION_STATUS = "awaiting connection";

export const AWAITING_APPROVAL_STATUS = "awaiting approval";

/** Where a missing connection is fixed. */
export const CONNECT_HREF = "/settings#accounts";

export function isShouldBeLiveEventStatus(status: string): boolean {
  return status.toLowerCase() === SHOULD_BE_LIVE_STATUS;
}

export function isOverdueEventStatus(status: string): boolean {
  return status.toLowerCase() === OVERDUE_STATUS;
}

export function isNeedsConnectionEventStatus(status: string): boolean {
  return status.toLowerCase() === NEEDS_CONNECTION_STATUS;
}

export function isAwaitingConnectionEventStatus(status: string): boolean {
  return status.toLowerCase() === AWAITING_CONNECTION_STATUS;
}

export function isAwaitingApprovalEventStatus(status: string): boolean {
  return status.toLowerCase() === AWAITING_APPROVAL_STATUS;
}

/** A post whose slot passed and which is not out: not "scheduled", not a failure, and it needs a look. */
export function isLateEventStatus(status: string): boolean {
  return isShouldBeLiveEventStatus(status) || isOverdueEventStatus(status) || isNeedsConnectionEventStatus(status);
}

/** The Day Summary and the calendar chips treat these as failures. */
export function isFailedEventStatus(status: string): boolean {
  const value = status.toLowerCase();
  return value === "failed" || value === "error" || value === "partly failed";
}

export type CalendarSource = {
  id: CalendarSourceId;
  /** Full name for legends and empty states. */
  label: string;
  /** Compact name for filter chips and event rows. */
  shortLabel: string;
  /** Dot/accent colour used everywhere this source appears. */
  color: string;
  /** The calendar page that owns these events. */
  href: string;
  hrefLabel: string;
};

export const CALENDAR_SOURCES: CalendarSource[] = [
  {
    id: "shorts",
    label: "Scheduled shorts uploads",
    shortLabel: "Shorts",
    color: "#a855f7",
    href: "/uploading-center",
    hrefLabel: "Uploading Center"
  },
  {
    id: "carousels",
    label: "Carousel upload schedules",
    shortLabel: "Carousels",
    color: "#e1306c",
    href: "/carousels",
    hrefLabel: "Carousels"
  },
  {
    id: "queued-carousels",
    label: "Scheduled carousel posts",
    shortLabel: "Carousel posts",
    color: "#e1306c",
    href: "/carousels",
    hrefLabel: "Carousels"
  },
  {
    id: "x",
    label: "Threads daily packs",
    shortLabel: "Threads",
    color: "#38bdf8",
    href: "/x-posts",
    hrefLabel: "Threads Autopilot"
  },
  {
    id: "fb",
    label: "FB / IG thread posts",
    shortLabel: "FB / IG",
    color: "#1877f2",
    href: "/facebook",
    hrefLabel: "FB / IG Post Library"
  },
  {
    id: "content",
    label: "Long-form & tracked content",
    shortLabel: "Long-form",
    color: "#f59e0b",
    href: "/distribution",
    hrefLabel: "Distribution Centre"
  }
];

export const CALENDAR_SOURCE_BY_ID: Record<CalendarSourceId, CalendarSource> = Object.fromEntries(
  CALENDAR_SOURCES.map((source) => [source.id, source])
) as Record<CalendarSourceId, CalendarSource>;

export function eventHref(event: Pick<MasterCalendarEvent, "source" | "href">): string {
  return event.href || CALENDAR_SOURCE_BY_ID[event.source].href;
}

export type MasterCalendarResponse = {
  timezone: string;
  /** Whether the shorts publisher is configured on (mirrors /api/publish). */
  publishEnabled: boolean;
  /** First day of the returned window, YYYY-MM-DD. */
  start: string;
  /**
   * Today's calendar day in `timezone`, YYYY-MM-DD. The Day Summary's "Today"
   * is this, not the browser's clock: a browser in UTC is a day ahead of the
   * publish zone for hours every evening.
   */
  today?: string;
  days: number;
  events: MasterCalendarEvent[];
  /**
   * The last YouTube numbers the app has cached for the videos in `events`
   * (read from disk, never from YouTube), so a screen can show them with the
   * events instead of waiting for a second request.
   */
  youtubeStats?: Record<string, YoutubeStat>;
};

/**
 * A repeating carousel schedule is a note to post by hand, not something the
 * app will publish. It must never be drawn like a booked post.
 */
export function isReminderEventStatus(status: string): boolean {
  return status.toLowerCase() === "reminder";
}

/** What a status reads as on screen: reminder and the past-slot statuses are capitalised, the rest as stored. */
export function eventStatusLabel(status: string, event?: Pick<MasterCalendarEvent, "legs">): string {
  if (isReminderEventStatus(status)) return "Reminder";
  if (isNeedsConnectionEventStatus(status) || isAwaitingConnectionEventStatus(status)) {
    // The Uploading Center's own words: "Needs YouTube connection", or the plain form when several platforms wait.
    const platforms = [
      ...new Set(
        (event?.legs ?? [])
          .filter((leg) => (isNeedsConnectionEventStatus(status) ? leg.late === "needs-connection" : leg.awaitingConnection))
          .map((leg) => leg.platform)
      )
    ];
    return platforms.length === 1 ? `Needs ${platforms[0]} connection` : "Needs connection";
  }
  if (isShouldBeLiveEventStatus(status)) return SHOULD_BE_LIVE_LABEL;
  if (isOverdueEventStatus(status)) return OVERDUE_LABEL;
  if (isAwaitingApprovalEventStatus(status)) return "Awaiting approval";
  // A booked post that has not gone out yet is "scheduled" to the person, whatever the source calls it.
  return status.toLowerCase() === "queued" ? SCHEDULED_WORD : status;
}
