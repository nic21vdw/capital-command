import { NextRequest, NextResponse } from "next/server";
import { getAccount, primaryAccountId } from "@/lib/publisher/accounts";
import { connectErrorUrl, missingCredentialsMessage, oauthCredentialsMissing, redirectWithinApp } from "@/lib/publisher/connectStart";
import { tiktokAuthUrl, tiktokRedirectUri } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/tiktok — kick off the TikTok OAuth consent flow. ?account=
 * picks which connected profile the minted token belongs to; it rides in the
 * OAuth state parameter so the callback stores it under that account's key
 * instead of overwriting the primary's.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("tiktok");
  if (oauthCredentialsMissing("tiktok")) {
    return redirectWithinApp(connectErrorUrl(origin, "tiktok", missingCredentialsMessage("tiktok")));
  }
  try {
    const account = await getAccount(accountId);
    if (!account || account.platform !== "tiktok") {
      return NextResponse.json({ error: "No such TikTok account." }, { status: 404 });
    }
    return NextResponse.redirect(await tiktokAuthUrl(tiktokRedirectUri(origin), accountId));
  } catch (error) {
    return redirectWithinApp(connectErrorUrl(origin, "tiktok", error instanceof Error ? error.message : String(error)));
  }
}
