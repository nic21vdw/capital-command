import { dateTimeFormat } from "@/lib/publisher/intl";
import type { AppData, Carousel, ContentItem, FbPost, XDailyPack } from "@/types/domain";
import { isImagePost } from "@/lib/publisher/images";
import { describeFailure } from "@/lib/publisher/failure";
import { isConnectionProblem, plainReason } from "@/lib/automations/plain";
import { remoteUrlFor } from "@/lib/publisher/remoteUrl";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import { isVideoId } from "@/lib/publisher/youtubeStatsShared";
import type { LegHeld } from "@/lib/publisher/approval";
import type { LegConnected } from "@/lib/publisher/legConnection";
import { pastSlotMarker, slotOverdue } from "@/lib/publisher/nativeScheduling";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import {
  AWAITING_APPROVAL_STATUS,
  AWAITING_CONNECTION_STATUS,
  NEEDS_CONNECTION_STATUS,
  OVERDUE_STATUS,
  SHOULD_BE_LIVE_STATUS,
  type CalendarSourceId,
  type LateKind,
  type MasterCalendarEvent
} from "@/lib/master-calendar/types";

/**
 * Flattens every distribution surface into MasterCalendarEvents for a
 * [startKey, startKey + days) window of local calendar days. Publish-queue
 * instants (UTC) are mapped to calendar days in the configured publish
 * timezone; every other source already stores local YYYY-MM-DD dates and is
 * used as-is.
 */

const DAY_MS = 86_400_000;

const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn"
};

/** Calendar-day arithmetic on YYYY-MM-DD keys via UTC ms (never an instant). */
function parseKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function addDaysToKey(key: string, days: number): string {
  return new Date(parseKey(key) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOfKey(key: string): number {
  return new Date(parseKey(key)).getUTCDay();
}

/** Today's calendar date as observed in `timeZone`. en-CA renders YYYY-MM-DD. */
export function todayKeyIn(timeZone: string, now = new Date()): string {
  return dateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A UTC instant's local calendar date + wall-clock time in `timeZone`. */
function localDateTime(instant: Date, timeZone: string): { dateKey: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`
  };
}

function inRange(dateKey: string, startKey: string, endKeyExclusive: string): boolean {
  return dateKey >= startKey && dateKey < endKeyExclusive;
}

function truncate(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function carouselIdFromQueuePath(filePath: string): string | undefined {
  const match = filePath.replace(/\\/g, "/").match(/(?:^|\/)carousels\/([^/]+)(?:\/|$)/);
  return match?.[1];
}

const PLATFORM_ORDER: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook", "linkedin"];

/**
 * The card for one queue item. The tab is the platform that needs a look: the
 * one that failed, then the one waiting on a hand-post, then the first the post
 * targets. Opening YouTube for a post whose Instagram leg failed showed a tab
 * that looked perfectly healthy.
 */
function uploadingCenterHref(item: QueueItem, platform?: PlatformId): string {
  const params = new URLSearchParams();
  params.set("item", item.id);
  const target =
    platform ??
    PLATFORM_ORDER.find((id) => item.platforms[id]?.status === "failed") ??
    PLATFORM_ORDER.find((id) => item.platforms[id]?.status === "manual") ??
    PLATFORM_ORDER.find((id) => item.platforms[id]);
  if (target) params.set("platform", target);
  return `/uploading-center?${params.toString()}`;
}

export function sourceHrefForDay(source: CalendarSourceId, dateKey: string): string {
  if (source === "shorts") return `/uploading-center?day=${encodeURIComponent(dateKey)}`;
  if (source === "x") return `/x-posts?date=${encodeURIComponent(dateKey)}`;
  if (source === "fb") return `/facebook?tab=library&date=${encodeURIComponent(dateKey)}`;
  if (source === "content") return "/longform";
  return "/carousels";
}

/**
 * Whether one leg is past its slot without the usual ending, by the SAME rule
 * the Uploading Center's chip uses (`pastSlotMarker`): a scheduled YouTube or
 * Facebook leg the platform should have published, or a pending leg the
 * publisher has not sent. A pending leg on an account with no connection could
 * never be sent: it is "needs-connection" (the board's "Needs <Platform>
 * connection"), not overdue. `isConnected` is the server's answer to "does this
 * account publish"; absent, everything counts as connected.
 */
function lateKind(item: QueueItem, platform: PlatformId, now: Date, isConnected?: LegConnected, held?: LegHeld): LateKind | null {
  const leg = item.platforms[platform];
  if (!leg || held?.(platform, leg)) return null;
  const connected = isConnected ? isConnected(platform, item.accountId ?? `${platform}-primary`) : true;
  if (leg.status === "pending" && !connected) return slotOverdue(item.publishAt, now) ? "needs-connection" : null;
  return pastSlotMarker(platform, leg, item, now, { connected })?.kind ?? null;
}

/**
 * Whether one leg is waiting on a connection with its slot still ahead: pending
 * on an account that does not publish. The Uploading Center says "Needs
 * <Platform> connection" for it before the slot too; the calendar used to call
 * it "queued". Not late, so it never carries `late` - once the slot passes it
 * becomes the "needs-connection" kind above.
 */
function awaitingConnection(item: QueueItem, platform: PlatformId, now: Date, isConnected?: LegConnected): boolean {
  const leg = item.platforms[platform];
  if (!leg || leg.status !== "pending" || !isConnected) return false;
  if (isConnected(platform, item.accountId ?? `${platform}-primary`)) return false;
  return !slotOverdue(item.publishAt, now);
}

/**
 * One overall status for a queue item across its per-platform states:
 * everything landed → published, everything dead → failed, some dead →
 * "partly failed" (it must not read as scheduled while one leg is lost), then
 * a slot that passed without the post going out ("overdue" when the publisher
 * never sent a leg, "should be live" when a platform holds it past its time),
 * then a leg that cannot go out for want of a connection with its slot still
 * ahead ("awaiting connection"), anything already uploaded/natively scheduled → scheduled, otherwise still
 * queued. `now` is what "past its slot" is measured against.
 */
export function queueItemStatus(item: QueueItem, now: Date = new Date(), isConnected?: LegConnected, held?: LegHeld): string {
  const states = Object.values(item.platforms);
  if (states.length > 0 && states.every((state) => state?.status === "published")) return "published";
  if (states.length > 0 && states.every((state) => state?.status === "failed")) return "failed";
  if (states.some((state) => state?.status === "failed")) return "partly failed";
  const late = PLATFORM_ORDER.map((id) => lateKind(item, id, now, isConnected, held));
  if (late.includes("needs-connection")) return NEEDS_CONNECTION_STATUS;
  if (late.includes("overdue")) return OVERDUE_STATUS;
  if (late.includes("should-be-live")) return SHOULD_BE_LIVE_STATUS;
  if (held && PLATFORM_ORDER.some((id) => item.platforms[id] && held(id, item.platforms[id]!))) return AWAITING_APPROVAL_STATUS;
  if (PLATFORM_ORDER.some((id) => awaitingConnection(item, id, now, isConnected))) return AWAITING_CONNECTION_STATUS;
  if (states.some((state) => state?.status === "scheduled" || state?.status === "uploaded")) return "scheduled";
  return "queued";
}

/** Platforms of a queue item in a given state, as display labels. */
function platformsIn(item: QueueItem, status: "failed" | "manual"): PlatformId[] {
  return PLATFORM_ORDER.filter((id) => item.platforms[id]?.status === status);
}

/** "Open on <platform>" links for the legs that are live and whose URL shape is known. */
function liveLinksFor(item: QueueItem): { platform: string; url: string }[] {
  const links: { platform: string; url: string }[] = [];
  for (const id of PLATFORM_ORDER) {
    const state = item.platforms[id];
    if (!state || state.status !== "published") continue;
    const url = remoteUrlFor(id, state.postId, state.status);
    if (url) links.push({ platform: PLATFORM_LABELS[id], url });
  }
  return links;
}

/** Every platform the queue item targets with where it stands, for per-platform roll-ups. */
function legsFor(item: QueueItem, now: Date, isConnected?: LegConnected, held?: LegHeld): NonNullable<MasterCalendarEvent["legs"]> {
  return PLATFORM_ORDER.filter((id) => item.platforms[id]).map((id) => {
    const state = item.platforms[id]!;
    const url = state.status === "published" ? remoteUrlFor(id, state.postId, state.status) : null;
    const late = lateKind(item, id, now, isConnected, held);
    return {
      platform: PLATFORM_LABELS[id],
      status: state.status,
      ...(late ? { late } : {}),
      ...(awaitingConnection(item, id, now, isConnected) ? { awaitingConnection: true as const } : {}),
      ...(held?.(id, state) ? { awaitingApproval: true as const } : {}),
      ...(url ? { url } : {}),
      // Each leg opens ITS platform's tab. The event's own href points at the
      // platform that needs a look (a failed or hand-post leg), which is the
      // wrong place to send a row about a different network.
      href: uploadingCenterHref(item, id)
    };
  });
}

function shortsEvents(
  items: QueueItem[],
  timeZone: string,
  startKey: string,
  endKey: string,
  now: Date,
  isConnected?: LegConnected,
  held?: LegHeld
): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const item of items) {
    const instant = new Date(item.publishAt);
    if (Number.isNaN(instant.getTime())) continue;
    const { dateKey, time } = localDateTime(instant, timeZone);
    if (!inRange(dateKey, startKey, endKey)) continue;
    // A picture post rides the same queue as the shorts but is not one — the
    // calendar filed a booked carousel under Shorts, where he would never look
    // for it.
    const picture = isImagePost(item);
    const carouselId = picture ? carouselIdFromQueuePath(item.clipPath) : undefined;
    const failed = platformsIn(item, "failed");
    const manual = platformsIn(item, "manual");
    const liveLinks = liveLinksFor(item);
    const youtubeLeg = item.platforms.youtube;
    const youtubeVideo =
      !picture && !youtubeHoldsForReview(item) && youtubeLeg?.status === "published" && youtubeLeg.postId && isVideoId(youtubeLeg.postId)
        ? youtubeLeg.postId
        : null;
    events.push({
      id: `${picture ? "queued-carousels" : "shorts"}:${item.id}`,
      source: picture ? "queued-carousels" : "shorts",
      dateKey,
      time,
      title: truncate(
        item.title || item.clipPath.split("/").pop() || (picture ? "Scheduled carousel" : "Scheduled short")
      ),
      platforms: (Object.keys(item.platforms) as PlatformId[]).map((platform) => PLATFORM_LABELS[platform]),
      status: queueItemStatus(item, now, isConnected, held),
      // A frame of the file itself, served by the same routes the uploading
      // board uses: the clip's poster frame, or slide one of a picture post.
      thumbnailUrl: picture ? `/api/publish/${item.id}/images/0` : `/api/publish/${item.id}/thumbnail`,
      href: picture && failed.length === 0
        ? carouselId
          ? `/carousels?open=${encodeURIComponent(carouselId)}`
          : "/carousels"
        : uploadingCenterHref(item),
      ...(failed.length > 0 ? { failedPlatforms: failed.map((id) => PLATFORM_LABELS[id]) } : {}),
      ...(failed.length > 0
        ? {
            failures: failed.map((id) => ({
              platform: PLATFORM_LABELS[id],
              // The sentence the Uploading Center card leads with, never the
              // provider's own payload.
              reason: describeFailure(item.platforms[id]!, id, { publishAt: item.publishAt }).headline,
              href: uploadingCenterHref(item, id)
            }))
          }
        : {}),
      // A long-form upload goes up private and stays private until it is made
      // public by hand. Only the YouTube leg is held: nothing else carries one.
      ...(item.platforms.youtube && youtubeHoldsForReview(item) ? { heldForReview: true } : {}),
      ...(manual.length > 0
        ? {
            manual: manual.map((id) => ({
              platform: PLATFORM_LABELS[id],
              href: uploadingCenterHref(item, id),
              // A picture post's slides are rendered files the app serves; a
              // video clip has no download route, so the card is the way in.
              ...(picture ? { fileUrl: `/api/publish/${item.id}/images/0` } : {})
            }))
          }
        : {}),
      ...(liveLinks.length > 0 ? { liveLinks } : {}),
      legs: legsFor(item, now, isConnected, held),
      ...(youtubeVideo ? { youtube: { itemId: item.id, videoId: youtubeVideo } } : {})
    });
  }
  return events;
}

/**
 * Carousel upload schedules (PR #203's Carousel.schedules — once/daily/weekly
 * at a wall-clock time, anchored on a start date). Read structurally so this
 * compiles before that branch lands: until the field exists in the storage
 * schema the array is simply absent and carousels contribute no events.
 */
type CarouselScheduleLike = {
  id: string;
  platforms?: string[];
  time?: string;
  recurrence?: "once" | "daily" | "weekly";
  date?: string;
  weekday?: number;
};

function carouselEvents(carousels: Carousel[], startKey: string, endKey: string, days: number): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const carousel of carousels) {
    const schedules = (carousel as Carousel & { schedules?: CarouselScheduleLike[] }).schedules ?? [];
    for (const schedule of schedules) {
      if (!schedule?.date) continue;
      const platforms = (schedule.platforms ?? []).map(
        (platform) => PLATFORM_LABELS[platform as PlatformId] ?? platform
      );
      const base = {
        source: "carousels" as const,
        time: schedule.time,
        title: truncate(carousel.title || "Carousel"),
        platforms,
        // A carousel schedule is a reminder to post by hand; the posts the
        // app really publishes come in through the publish queue instead.
        status: "reminder",
        href: `/carousels?open=${encodeURIComponent(carousel.id)}`
      };
      const recurrence = schedule.recurrence ?? "once";
      if (recurrence === "once") {
        if (inRange(schedule.date, startKey, endKey)) {
          events.push({ ...base, id: `carousel:${schedule.id}:${schedule.date}`, dateKey: schedule.date });
        }
        continue;
      }
      const anchorWeekday = schedule.weekday ?? weekdayOfKey(schedule.date);
      for (let offset = 0; offset < days; offset += 1) {
        const dateKey = addDaysToKey(startKey, offset);
        if (dateKey < schedule.date) continue;
        if (recurrence === "weekly" && weekdayOfKey(dateKey) !== anchorWeekday) continue;
        events.push({ ...base, id: `carousel:${schedule.id}:${dateKey}`, dateKey, recurring: true });
      }
    }
  }
  return events;
}

/**
 * One status for the Threads queue items behind a single pack slot (one per
 * connected account). Mirrors the shorts roll-up: all sent → published, all
 * dead → failed, some dead → "partly failed", still waiting → queued. A slot
 * whose time passed while nothing was running is "skipped" on purpose, so it
 * must not read as failed or as sent.
 */
export function threadsSlotStatus(items: Pick<ThreadsQueueItem, "status">[]): string {
  const statuses = items.map((item) => item.status);
  if (statuses.length === 0) return "planned";
  if (statuses.every((status) => status === "published")) return "published";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "failed")) return "partly failed";
  if (statuses.some((status) => status === "pending")) return "queued";
  // Sent on some accounts and skipped on the rest.
  return "published";
}

/**
 * Why a Threads slot failed and where to fix it, in the words the Automations
 * page already uses ("Threads connection expired - reconnect in Settings").
 * One line per distinct reason, so two accounts failing the same way read once.
 * A dead login is fixed in Settings > Accounts; anything else is a post to retry
 * on the Autopilot board for that day.
 */
function threadsFailures(items: ThreadsQueueItem[], dateKey: string): NonNullable<MasterCalendarEvent["failures"]> {
  const out: NonNullable<MasterCalendarEvent["failures"]> = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.status !== "failed") continue;
    const raw = item.error?.trim() ?? "";
    const reason = raw ? plainReason(raw, "threads") : "no reason was recorded";
    if (seen.has(reason)) continue;
    seen.add(reason);
    const connection = raw ? isConnectionProblem(raw, "threads") : false;
    out.push({
      platform: "Threads",
      reason,
      href: connection ? "/settings#accounts" : `/x-posts?date=${encodeURIComponent(dateKey)}`,
      fixLabel: connection ? "Open Accounts in Settings" : "Fix in Threads Autopilot"
    });
  }
  return out;
}

/**
 * Threads, from two stores that each know half of it. The X pack says what was
 * planned for the day (every slot, its topic and its suggested time); the
 * Threads queue says what actually happened to each post. A slot with queue
 * items takes their real status and time; a slot with none is still only
 * "planned". Queue items with no pack behind them (the pack was pruned, or the
 * post came from a stream) get an event of their own so the day is never missing
 * a post that went out.
 */
function xEvents(
  packs: XDailyPack[],
  threadsItems: ThreadsQueueItem[],
  timeZone: string,
  startKey: string,
  endKey: string
): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  // Only the autopilot's own items belong to a pack slot; a post added from a
  // stream carries its own slot numbering.
  const bySlot = new Map<string, ThreadsQueueItem[]>();
  for (const item of threadsItems) {
    if (item.origin === "pipeline") continue;
    const key = `${item.batchDate}:${item.slot}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)!.push(item);
  }
  const claimed = new Set<string>();

  const earliestTime = (items: ThreadsQueueItem[]): string | undefined => {
    const instants = items
      .map((item) => new Date(item.publishAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return instants[0] ? localDateTime(instants[0], timeZone).time : undefined;
  };

  for (const pack of packs) {
    if (!inRange(pack.date, startKey, endKey)) continue;
    for (const post of pack.posts) {
      const key = `${pack.date}:${post.slot}`;
      const queued = bySlot.get(key) ?? [];
      if (queued.length > 0) claimed.add(key);
      events.push({
        id: `x:${pack.id}:${post.id}`,
        source: "x",
        dateKey: pack.date,
        // A start-now batch is laid out from the button press, not at the
        // pack's suggested times, so the queue's own time is the true one.
        time: (queued.length > 0 ? earliestTime(queued) : undefined) ?? post.time,
        title: truncate(post.topic || post.text),
        platforms: queued.length > 0 ? ["Threads"] : ["X", "Threads"],
        status: threadsSlotStatus(queued),
        href: `/x-posts?date=${encodeURIComponent(pack.date)}`,
        ...(queued.length > 0 && threadsSlotStatus(queued).endsWith("failed")
          ? { failedPlatforms: ["Threads"], failures: threadsFailures(queued, pack.date) }
          : {})
      });
    }
  }

  const unclaimed = new Map<string, ThreadsQueueItem[]>();
  for (const [key, items] of bySlot) {
    if (!claimed.has(key)) unclaimed.set(key, items);
  }
  for (const item of threadsItems) {
    if (item.origin === "pipeline") unclaimed.set(`pipeline:${item.id}`, [item]);
  }
  for (const [key, items] of unclaimed) {
    const first = items[0];
    if (!inRange(first.batchDate, startKey, endKey)) continue;
    const status = threadsSlotStatus(items);
    events.push({
      id: `x:queue:${key}`,
      source: "x",
      dateKey: first.batchDate,
      time: earliestTime(items),
      title: truncate(first.topic || first.text),
      platforms: ["Threads"],
      status,
      href: `/x-posts?date=${encodeURIComponent(first.batchDate)}`,
      ...(status.endsWith("failed")
        ? { failedPlatforms: ["Threads"], failures: threadsFailures(items, first.batchDate) }
        : {})
    });
  }
  return events;
}

function fbEvents(posts: FbPost[], startKey: string, endKey: string): MasterCalendarEvent[] {
  return posts
    .filter((post) => inRange(post.date, startKey, endKey))
    .map((post) => ({
      id: `fb:${post.id}`,
      source: "fb" as const,
      dateKey: post.date,
      title: truncate(post.hook || post.body),
      platforms: [post.platform === "facebook" ? "Facebook" : "Instagram"],
      status: post.status,
      // A post that is already up has nothing left to edit; what is missing is
      // how it did, so the link opens the card with its "Log results" form.
      href: `/facebook?tab=library&open=${encodeURIComponent(post.id)}${post.status === "posted" ? "&log=1" : ""}`
    }));
}

function contentEvents(items: ContentItem[], startKey: string, endKey: string): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];
  for (const item of items) {
    const dateKey = item.publishDate?.slice(0, 10);
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !inRange(dateKey, startKey, endKey)) continue;
    const time = item.publishDate?.match(/[T ](\d{2}:\d{2})/)?.[1];
    events.push({
      id: `content:${item.id}`,
      source: "content",
      dateKey,
      time,
      title: truncate(item.title),
      platforms: [item.platform],
      status: item.status.toLowerCase(),
      href: "/longform"
    });
  }
  return events;
}

export function buildMasterCalendarEvents(options: {
  data: AppData;
  queueItems: QueueItem[];
  /** The Threads autopilot's queue; absent or empty leaves Threads as the pack's plan. */
  threadsItems?: ThreadsQueueItem[];
  /** Zone the Threads queue's instants are read in; defaults to `timeZone`. */
  threadsTimeZone?: string;
  timeZone: string;
  startKey: string;
  days: number;
  /** The clock "past its slot" is read against; tests pass one, the routes use the real one. */
  now?: Date;
  /** Whether the account behind a queue leg is connected; absent, every account counts as connected. */
  isConnected?: LegConnected;
  /** Whether a leg is waiting on the owner's approval; absent, nothing is held. */
  held?: LegHeld;
}): MasterCalendarEvent[] {
  const { data, queueItems, threadsItems = [], threadsTimeZone, timeZone, startKey, days, now = new Date(), isConnected, held } = options;
  const endKey = addDaysToKey(startKey, days);

  const events = [
    ...shortsEvents(queueItems, timeZone, startKey, endKey, now, isConnected, held),
    ...carouselEvents(data.videoStudio?.carousels ?? [], startKey, endKey, days),
    ...xEvents(data.xPlanner?.packs ?? [], threadsItems, threadsTimeZone ?? timeZone, startKey, endKey),
    ...fbEvents(data.fbStrategy?.posts ?? [], startKey, endKey),
    ...contentEvents(data.contentItems ?? [], startKey, endKey)
  ];

  // Day-level items (no time) first, then chronological — matches how the
  // calendar renders a day: all-day rows above the timed plan.
  return events.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    if (!a.time || !b.time) return a.time ? 1 : b.time ? -1 : 0;
    return a.time.localeCompare(b.time);
  });
}
