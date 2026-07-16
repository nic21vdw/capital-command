import { NextRequest, NextResponse } from "next/server";
import {
  isPrimaryAccountId,
  itemBelongsToAccount,
  primaryAccountId
} from "@/lib/publisher/accounts";
import {
  exchangeGoogleCode,
  isYoutubeReconnectRequired
} from "@/lib/publisher/googleAuth";
import { publishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    // A revoked refresh token is permanent until the user reconnects. Once a
    // fresh token is stored, revive only the uploads that failed for that exact
    // reason/account, then retry them immediately. Other permanent failures
    // remain untouched.
    const queue = publishQueue();
    const retryIds: string[] = [];
    for (const item of await queue.list()) {
      const state = item.platforms.youtube;
      if (
        state?.status === "failed" &&
        isYoutubeReconnectRequired(state.error) &&
        itemBelongsToAccount(item, "youtube", accountId)
      ) {
        state.status = "pending";
        state.attempts = 0;
        state.error = undefined;
        state.nextAttemptAt = undefined;
        state.claimedAt = undefined;
        retryIds.push(item.id);
      }
    }
    if (retryIds.length > 0) {
      await queue.save();
      for (const itemId of retryIds) {
        // Keep OAuth success independent from a later media/API failure. The
        // runner records any new failure on the queue with its proper status.
        await runDue(new Date(), { itemId }).catch(() => undefined);
      }
      target.searchParams.set("recovered", String(retryIds.length));
    }

    target.searchParams.set("connected", "youtube");
    if (!isPrimaryAccountId(accountId)) target.searchParams.set("account", accountId);
  } catch (error) {
    target.searchParams.set("connect_error", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target);
}
