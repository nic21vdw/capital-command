import { NextRequest, NextResponse } from "next/server";
import { getAccount, primaryAccountId } from "@/lib/publisher/accounts";
import { googleAuthUrl } from "@/lib/publisher/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google?account=<id> — kick off the YouTube OAuth consent flow
 * for one of our accounts (default: the primary account). The account id
 * rides in the OAuth state parameter so the callback stores the minted tokens
 * under that account's cache keys.
 */
export async function GET(request: NextRequest) {
  const redirectUri = `${request.nextUrl.origin}/api/auth/google/callback`;
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("youtube");
  try {
    const account = await getAccount(accountId);
    if (!account || account.platform !== "youtube") {
      return NextResponse.json({ error: "No such YouTube account — add it in the Uploading Center first." }, { status: 400 });
    }
    return NextResponse.redirect(googleAuthUrl(redirectUri, accountId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
