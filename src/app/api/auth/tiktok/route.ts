import { NextRequest, NextResponse } from "next/server";
import { getAccount, primaryAccountId } from "@/lib/publisher/accounts";
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
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("tiktok");
  try {
    const account = await getAccount(accountId);
    if (!account || account.platform !== "tiktok") {
      return NextResponse.json({ error: "No such TikTok account." }, { status: 404 });
    }
    return NextResponse.redirect(await tiktokAuthUrl(tiktokRedirectUri(request.nextUrl.origin), accountId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
