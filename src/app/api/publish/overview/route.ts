import { NextRequest, NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { youtubeQuota } from "@/lib/publisher/quota";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots } from "@/lib/publisher/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far the schedule grid can page from today, in either direction: ten years. */
const MAX_OFFSET_DAYS = 3650;

/**
 * GET /api/publish/overview?days=14&offsetDays=0 — whether publishing is on,
 * the YouTube quota meter, and the schedule grid slots (built server-side so
 * wall-clock labels are in PUBLISH_TIMEZONE and instants are UTC).
 * `offsetDays` moves the slot window relative to today so the UI can page
 * through past and future scheduling periods (negative = earlier).
 *
 * Everything here is read from local config and the queue file — no social
 * network is contacted. Who each account posts as lives on
 * /api/publish/accounts, which is where the UI reads it from; this route used
 * to report the same profiles again from four live API calls that the whole
 * app then ignored.
 *
 * `slotsOnly=1` answers with just the grid — for callers that only want
 * somewhere to put a video (the editor's Schedule Short menu). The Uploading
 * Center is NOT one of them: `generateSlots` is pure arithmetic over the
 * timezone and the offset, so its calendar builds the grid in the browser and
 * paging costs no request at all.
 */
export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 60) : 14;
  const offsetRaw = Number(request.nextUrl.searchParams.get("offsetDays"));
  const offsetDays = Number.isFinite(offsetRaw)
    ? Math.max(-MAX_OFFSET_DAYS, Math.min(Math.trunc(offsetRaw), MAX_OFFSET_DAYS))
    : 0;

  const now = new Date();

  if (request.nextUrl.searchParams.get("slotsOnly") === "1") {
    const slots = generateSlots({ timeZone: config.timezone, days, startDayOffset: offsetDays, now });
    return NextResponse.json({ enabled: config.enabled, timezone: config.timezone, slotOffsetDays: offsetDays, slots });
  }

  const items = config.enabled ? await publishQueue(config).list() : [];

  return NextResponse.json({
    enabled: config.enabled,
    timezone: config.timezone,
    quota: youtubeQuota(items, now, config)
  });
}
