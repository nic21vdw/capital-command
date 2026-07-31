import { NextRequest, NextResponse } from "next/server";
import { tiktokAuthUrl, tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/tiktok — kick off the TikTok OAuth consent flow for the
 * primary TikTok account. TikTok has no per-account concept here yet: one
 * connected profile, the same one the Content Posting API adapter publishes
 * with.
 */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(await tiktokAuthUrl(tiktokRedirectUri(request.nextUrl.origin)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
