import { NextRequest, NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/publisher/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/google — kick off the YouTube OAuth consent flow. */
export function GET(request: NextRequest) {
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  try {
    return NextResponse.redirect(googleAuthUrl(redirectUri));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
