import { NextRequest, NextResponse } from "next/server";
import { isPrimaryAccountId, primaryAccountId } from "@/lib/publisher/accounts";
import { exchangeTiktokCode, tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/tiktok/callback — finish the OAuth flow for the account
 * carried in the state parameter. The code is exchanged server-side and the
 * refresh token is persisted server-side; the browser only sees a redirect
 * back to the Uploading Center.
 */
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("state") || primaryAccountId("tiktok");
  const target = new URL("/uploading-center", request.nextUrl.origin);
  if (!isPrimaryAccountId(accountId)) target.searchParams.set("account", accountId);
  const code = request.nextUrl.searchParams.get("code");
  const denied = request.nextUrl.searchParams.get("error_description") ?? request.nextUrl.searchParams.get("error");
  if (denied || !code) {
    target.searchParams.set("connect_error", denied || "TikTok returned no authorization code.");
    return NextResponse.redirect(target);
  }
  try {
    await exchangeTiktokCode(code, tiktokRedirectUri(request.nextUrl.origin), accountId);
    target.searchParams.set("connected", "tiktok");
  } catch (error) {
    target.searchParams.set("connect_error", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target);
}
