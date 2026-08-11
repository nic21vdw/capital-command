import { NextRequest, NextResponse } from "next/server";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeChannelSchedule } from "@/lib/publisher/channelVideos";
import { publisherConfig } from "@/lib/publisher/config";
import { channelDuplicateGroups, queueDuplicateGroups } from "@/lib/publisher/duplicates";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/youtube-channel/duplicates — the duplicate audit, in two
 * halves:
 *
 *   channel  videos already on YouTube that share a title. This is the only
 *            record that survives a deleted queue item, so it is what answers
 *            "did the app really post that short twice?".
 *   queue    posts booked to repeat each other, caught before anything uploads.
 *
 * Read-only: it deletes nothing and un-schedules nothing. What to do about a
 * group is a decision, and YouTube's own studio is where a video gets removed.
 *
 * ?account=<id> picks the connected YouTube account; ?refresh=1 skips the
 * 5-minute channel cache.
 */
export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("youtube");

  const schedule = await youtubeChannelSchedule({ force, accountId });
  const items = config.enabled ? await publishQueue(config).list() : [];

  return NextResponse.json({
    configured: schedule.configured,
    needsReconnect: schedule.needsReconnect,
    fetchedAt: schedule.fetchedAt,
    channelId: schedule.channelId,
    error: schedule.error,
    videosChecked: schedule.videos.length,
    channel: channelDuplicateGroups(schedule.videos).map((group) => ({
      title: group.title,
      videos: group.videos.map((video) => ({
        videoId: video.videoId,
        title: video.title,
        status: video.status,
        publishAtUtc: video.publishAtUtc,
        url: video.url
      }))
    })),
    queue: queueDuplicateGroups(items).map((group) => ({
      reason: group.reason,
      items: group.items.map((item) => ({
        id: item.id,
        title: item.title,
        clipPath: item.clipPath,
        publishAt: item.publishAt,
        platforms: Object.keys(item.platforms)
      }))
    }))
  });
}
