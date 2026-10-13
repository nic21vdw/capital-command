import { NextRequest, NextResponse } from "next/server";
import { connectErrorUrl, missingCredentialsMessage, oauthCredentialsMissing, redirectWithinApp } from "@/lib/publisher/connectStart";
import { spotifyAuthUrl, spotifyRedirectUri } from "@/lib/spotify/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/spotify — start the Spotify consent flow for the one account. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (oauthCredentialsMissing("spotify")) {
    return redirectWithinApp(connectErrorUrl(origin, "spotify", missingCredentialsMessage("spotify")));
  }
  try {
    return NextResponse.redirect(await spotifyAuthUrl(spotifyRedirectUri(origin)));
  } catch (error) {
    return redirectWithinApp(connectErrorUrl(origin, "spotify", error instanceof Error ? error.message : String(error)));
  }
}
