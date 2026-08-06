import { NextResponse } from "next/server";
import { buildFeedXml } from "@/lib/podcast/feed";
import { feedUrl } from "@/lib/podcast/publish";
import { readPodcastState } from "@/lib/podcast/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same feed the app writes to the media host, served locally so it can be
 * read and validated without a round trip. This is NOT the URL to give
 * Spotify — this app is not on the public internet. The hosted copy is.
 */
export async function GET() {
  const state = await readPodcastState();
  const xml = buildFeedXml(state.show, state.episodes, feedUrl() ?? "http://localhost:3000/api/podcast/rss");
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-store" }
  });
}
