import { NextRequest, NextResponse } from "next/server";
import { buildMasterCalendarEvents, todayKeyIn } from "@/lib/master-calendar/aggregate";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { readAppData } from "@/lib/storage/store";
import { threadsConfig } from "@/lib/threads/config";
import { readQueue as readThreadsQueue } from "@/lib/threads/queue";
import { liveStatsDeps } from "@/lib/publisher/youtubeStats";
import type { YoutubeStat } from "@/lib/publisher/youtubeStatsShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A month grid is 42 cells; leave headroom without allowing huge scans. */
const MAX_DAYS = 62;

function validDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The last YouTube numbers on disk for the published videos in these events.
 * Cache only - no call to YouTube - so the page can show numbers with its
 * events and let the live read refresh them afterwards. A cache that cannot
 * be read is just no numbers.
 */
async function cachedYoutubeStats(events: { youtube?: { videoId: string } }[]): Promise<Record<string, YoutubeStat>> {
  const ids = new Set(events.flatMap((event) => (event.youtube ? [event.youtube.videoId] : [])));
  if (ids.size === 0) return {};
  try {
    const cache = await liveStatsDeps.readCache();
    const out: Record<string, YoutubeStat> = {};
    for (const id of ids) if (cache[id]) out[id] = cache[id];
    return out;
  } catch {
    return {};
  }
}

/**
 * GET /api/master-calendar?start=YYYY-MM-DD&days=42 — every distribution
 * surface's events for the requested window of local calendar days, flattened
 * into one list (see buildMasterCalendarEvents). `start` may lie in the past
 * so the calendar can page backwards through published history.
 */
export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const startRaw = request.nextUrl.searchParams.get("start");
  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.max(1, Math.floor(daysRaw)), MAX_DAYS) : 42;
  const startKey = startRaw && validDateKey(startRaw) ? startRaw : todayKeyIn(config.timezone);

  const [data, queueItems, threadsItems] = await Promise.all([
    readAppData(),
    // Same gate as GET /api/publish: with the publisher off the queue file is
    // not consulted, so the two surfaces always agree on what's scheduled.
    config.enabled ? publishQueue(config).list() : Promise.resolve([]),
    // The Threads queue says what actually went out; the X pack only plans it.
    // A queue that cannot be read leaves Threads as the pack's plan.
    readThreadsQueue().catch(() => [])
  ]);

  const events = buildMasterCalendarEvents({
    data,
    queueItems,
    threadsItems,
    threadsTimeZone: threadsConfig().timezone,
    timeZone: config.timezone,
    startKey,
    days
  });

  return NextResponse.json({
    timezone: config.timezone,
    // The publish zone's today: what "Today" means on every screen that reads this.
    today: todayKeyIn(config.timezone),
    publishEnabled: config.enabled,
    start: startKey,
    days,
    events,
    youtubeStats: await cachedYoutubeStats(events)
  });
}
