import { NextRequest, NextResponse } from "next/server";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchCreatorPostingInfo } from "@/lib/publisher/tiktokPost";
import { tiktokAccessToken } from "@/lib/publisher/tiktokAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the connected TikTok account may be asked to post: the audiences it can
 * post to, which interactions it has switched off, and how long a video it
 * takes. The consent panel draws itself from this, so the options offered are
 * always the account's own rather than a list this app decided on.
 */
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("account") || primaryAccountId("tiktok");
  const token = await tiktokAccessToken(accountId);
  if (!token) {
    return NextResponse.json({ error: "This TikTok account is not connected." }, { status: 409 });
  }
  try {
    const info = await fetchCreatorPostingInfo(token);
    return NextResponse.json({ ...info, audited: publisherConfig().tiktok.audited });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TikTok would not answer for this account." },
      { status: 502 }
    );
  }
}
