import { NextRequest, NextResponse } from "next/server";
import { exchangeSpotifyCode, spotifyRedirectUri } from "@/lib/spotify/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/spotify/callback — finish the flow and land back on the
 * Podcast page. The code is exchanged server-side; the browser never sees the
 * client secret or the refresh token.
 */
export async function GET(request: NextRequest) {
  const target = new URL("/podcast", request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const denied = request.nextUrl.searchParams.get("error");
  if (denied || !code) {
    target.searchParams.set("connect_error", denied || "Spotify returned no authorization code.");
    return NextResponse.redirect(target);
  }
  try {
    await exchangeSpotifyCode(code, state, spotifyRedirectUri(request.nextUrl.origin));
    target.searchParams.set("connected", "spotify");
  } catch (error) {
    target.searchParams.set("connect_error", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target);
}
