import { NextRequest, NextResponse } from "next/server";
import { youtubeChannelSchedule } from "@/lib/publisher/channelVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/youtube-channel — the channel's real YouTube schedule:
 * upcoming scheduled uploads and recently published videos, read via the Data
 * API and cached server-side for 5 minutes. ?refresh=1 bypasses the cache
 * (used right after a publish so the new video shows up immediately).
 */
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  return NextResponse.json(await youtubeChannelSchedule({ force }));
}
