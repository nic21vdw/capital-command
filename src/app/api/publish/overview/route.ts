import { NextRequest, NextResponse } from "next/server";
import { configuredPlatforms, publisherConfig } from "@/lib/publisher/config";
import { youtubeChannelInfo } from "@/lib/publisher/googleAuth";
import { youtubeQuota } from "@/lib/publisher/quota";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots } from "@/lib/publisher/slots";
import type { PlatformId } from "@/lib/publisher/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far the schedule grid can page from today, in either direction: ten years. */
const MAX_OFFSET_DAYS = 3650;

/**
 * GET /api/publish/overview?days=14&offsetDays=0 — everything the Uploading
 * Center needs beyond the queue itself: whether publishing is on, which
 * platforms have credentials, the YouTube quota meter, and the schedule grid
 * slots (built server-side so wall-clock labels are in PUBLISH_TIMEZONE and
 * instants are UTC). `offsetDays` moves the slot window relative to today so the
 * UI can page through past and future scheduling periods (negative = earlier).
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
  const configured = new Set<PlatformId>(configuredPlatforms(config));
  const items = config.enabled ? await publishQueue(config).list() : [];

  return NextResponse.json({
    enabled: config.enabled,
    timezone: config.timezone,
    platforms: {
      youtube: {
        configured: configured.has("youtube"),
        account: configured.has("youtube") ? await youtubeChannelInfo() : null
      },
      instagram: { configured: configured.has("instagram") },
      tiktok: { configured: configured.has("tiktok") }
    },
    quota: youtubeQuota(items, now, config),
    // Echoed back so the client can tell which window the slots belong to
    // while a page-forward/-back fetch is still in flight.
    slotOffsetDays: offsetDays,
    slots: generateSlots({ timeZone: config.timezone, days, startDayOffset: offsetDays, now })
  });
}
