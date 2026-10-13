import { NextRequest, NextResponse } from "next/server";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { publishQueue } from "@/lib/publisher/queue";
import { liveStatsDeps, resolveYoutubeStats, type StatsRequest } from "@/lib/publisher/youtubeStats";
import { STATS_REFRESH_MIN_MS, isVideoId, type YoutubeStatsResponse } from "@/lib/publisher/youtubeStatsShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One request never asks YouTube about more than this many videos. */
const MAX_IDS = 200;

function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * GET /api/publish/youtube-stats?ids=a,b&items=<queue item ids>[&account=<id>][&refresh=1]
 * - views, likes and comments for videos this app posted to YouTube.
 *
 * Read-only: it never publishes and never changes the queue. Numbers are served
 * from data/youtube-stats.json and re-read from YouTube at most every 30
 * minutes per video. It always answers 200 with a `status` - ok, not-connected,
 * stale or error - and whatever numbers are cached, so a screen can show them
 * (with how old they are) instead of an error. `items` is resolved through the
 * running app's own queue, which also tells it which channel each video is on.
 *
 * `refresh=1` is the Refresh button: it shortens the 30-minute wait to one
 * minute per video and nothing else - a failed account is still left alone for
 * its back-off, and with no sign-in the answer is the same cached numbers.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const deps = params.get("refresh") === "1" ? { ...liveStatsDeps, ttlMs: STATS_REFRESH_MIN_MS } : liveStatsDeps;
  const defaultAccount = params.get("account") || primaryAccountId("youtube");
  const requests: StatsRequest[] = [];
  const items: Record<string, string> = {};

  try {
    const itemIds = list(params.get("items")).slice(0, MAX_IDS);
    if (itemIds.length > 0) {
      const queue = publishQueue();
      for (const itemId of itemIds) {
        const item = await queue.get(itemId);
        const leg = item?.platforms.youtube;
        if (!item || !leg || leg.status !== "published" || !leg.postId || !isVideoId(leg.postId)) continue;
        items[itemId] = leg.postId;
        requests.push({ videoId: leg.postId, accountId: item.accountId ?? primaryAccountId("youtube") });
      }
    }
    for (const id of list(params.get("ids")).slice(0, MAX_IDS)) {
      if (isVideoId(id)) requests.push({ videoId: id, accountId: defaultAccount });
    }
    const result = await resolveYoutubeStats(requests, deps);
    return NextResponse.json({ ...result, items });
  } catch {
    // Fail open: a broken stats read must never look like a broken app.
    const body: YoutubeStatsResponse = {
      status: "error",
      message: "Views could not be read right now.",
      stats: {},
      items
    };
    return NextResponse.json(body);
  }
}
