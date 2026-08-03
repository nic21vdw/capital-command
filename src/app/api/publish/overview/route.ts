import { NextRequest, NextResponse } from "next/server";
import { bufferConfigured, configuredPlatforms, publisherConfig } from "@/lib/publisher/config";
import { youtubeChannelInfo } from "@/lib/publisher/googleAuth";
import { facebookProfile, instagramProfile } from "@/lib/publisher/metaProfile";
import { tiktokCreatorInfo } from "@/lib/publisher/tiktokAuth";
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
 *
 * `slotsOnly=1` answers with just the grid — no platform accounts, no quota,
 * no queue read. Those four account lookups each hit a social network's API,
 * and callers that only want somewhere to put a video (the editor's Schedule
 * Short menu) were waiting on all of them for data they never render.
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
  const slots = generateSlots({ timeZone: config.timezone, days, startDayOffset: offsetDays, now });

  if (request.nextUrl.searchParams.get("slotsOnly") === "1") {
    return NextResponse.json({ enabled: config.enabled, timezone: config.timezone, slotOffsetDays: offsetDays, slots });
  }

  const configured = new Set<PlatformId>(configuredPlatforms(config));
  const items = config.enabled ? await publishQueue(config).list() : [];
  // The four account lookups are independent network reads — resolve them
  // together rather than one after another.
  const [youtube, instagram, tiktok, facebook] = await Promise.all([
    configured.has("youtube") ? youtubeChannelInfo() : null,
    configured.has("instagram") ? instagramProfile(config) : null,
    configured.has("tiktok") ? tiktokCreatorInfo() : null,
    configured.has("facebook") ? facebookProfile(config) : null
  ]);

  return NextResponse.json({
    enabled: config.enabled,
    timezone: config.timezone,
    // Every platform in ALL_PLATFORMS gets an entry, including the ones with
    // no credentials — the client types this as a full record and reads it by
    // platform id, so a missing key would read as undefined rather than off.
    platforms: {
      youtube: { configured: configured.has("youtube"), account: youtube },
      instagram: { configured: configured.has("instagram"), account: instagram },
      tiktok: { configured: configured.has("tiktok"), account: tiktok },
      facebook: { configured: configured.has("facebook"), account: facebook }
    },
    // Buffer is a delivery layer, not one of the four platforms — surfaced
    // separately so the UI can show it's managing scheduled posts. `enabled`
    // without `configured` means the token/profiles still need to be set.
    buffer: {
      enabled: config.buffer.enabled,
      configured: bufferConfigured(config),
      profileCount: config.buffer.profileIds.length
    },
    quota: youtubeQuota(items, now, config),
    // Echoed back so the client can tell which window the slots belong to
    // while a page-forward/-back fetch is still in flight.
    slotOffsetDays: offsetDays,
    slots
  });
}
