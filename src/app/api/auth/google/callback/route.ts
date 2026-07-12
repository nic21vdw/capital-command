import { NextRequest, NextResponse } from "next/server";
import { isPrimaryAccountId, primaryAccountId } from "@/lib/publisher/accounts";
import { exchangeGoogleCode } from "@/lib/publisher/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback — finish the OAuth flow. The code is
 * exchanged server-side and the refresh token is persisted server-side under
 * the account carried in the OAuth state parameter; the browser only sees a
 * redirect back to the Uploading Center.
 */
export async function GET(request: NextRequest) {
  const target = new URL("/uploading-center", request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get("code");
  const denied = request.nextUrl.searchParams.get("error");
  const accountId = request.nextUrl.searchParams.get("state") || primaryAccountId("youtube");
  if (denied || !code) {
    target.searchParams.set("connect_error", denied || "Google returned no authorization code.");
    return NextResponse.redirect(target);
  }
  try {
    await exchangeGoogleCode(code, `${request.nextUrl.origin}/api/auth/google/callback`, accountId);
    target.searchParams.set("connected", "youtube");
    if (!isPrimaryAccountId(accountId)) target.searchParams.set("account", accountId);
  } catch (error) {
    target.searchParams.set("connect_error", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target);
}
