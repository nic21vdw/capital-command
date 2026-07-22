import { NextRequest, NextResponse } from "next/server";
import { buildMasterCalendarEvents, todayKeyIn } from "@/lib/master-calendar/aggregate";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { readAppData } from "@/lib/storage/store";
import { listPodcastEpisodes } from "@/lib/podcasts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A month grid is 42 cells; leave headroom without allowing huge scans. */
const MAX_DAYS = 62;

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
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : 42;
  const startKey = startRaw && DATE_KEY_RE.test(startRaw) ? startRaw : todayKeyIn(config.timezone);

  const [data, queueItems, podcastEpisodes] = await Promise.all([
    readAppData(),
    // Same gate as GET /api/publish: with the publisher off the queue file is
    // not consulted, so the two surfaces always agree on what's scheduled.
    config.enabled ? publishQueue(config).list() : Promise.resolve([]),
    listPodcastEpisodes()
  ]);

  const events = buildMasterCalendarEvents({
    data,
    queueItems,
    timeZone: config.timezone,
    startKey,
    days,
    podcastEpisodes
  });

  return NextResponse.json({
    timezone: config.timezone,
    publishEnabled: config.enabled,
    start: startKey,
    days,
    events
  });
}
