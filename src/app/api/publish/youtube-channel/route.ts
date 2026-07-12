import { NextRequest, NextResponse } from "next/server";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { youtubeChannelSchedule } from "@/lib/publisher/channelVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/youtube-channel — a channel's real YouTube schedule:
 * upcoming scheduled uploads and recently published videos, read via the Data
 * API and cached server-side for 5 minutes per account. ?account=<id> picks
 * which connected YouTube account to read (default: the primary account);
 * ?refresh=1 bypasses the cache (used right after a publish so the new video
 * shows up immediately).
 */
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("youtube");
  return NextResponse.json(await youtubeChannelSchedule({ force, accountId }));
}
