import { NextRequest, NextResponse } from "next/server";
import { spotifyAuthUrl, spotifyRedirectUri } from "@/lib/spotify/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/spotify — start the Spotify consent flow for the one account. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(await spotifyAuthUrl(spotifyRedirectUri(request.nextUrl.origin)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
