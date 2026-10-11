import { NextRequest, NextResponse } from "next/server";
import { plannerConfigured } from "@/lib/x-posts/generator";
import { ensureDailyPack } from "@/lib/x-posts/daily";
import { threadsConfig } from "@/lib/threads/config";
import { zonedDateKey } from "@/lib/threads/zone";

/**
 * Returns today's X/Threads pack, generating it on first request of the day
 * (or on demand with `force`). Suggestion-only: this route never records
 * anything about what actually got posted — see /api/threads for the autopilot
 * that schedules the pack onto Threads.
 */
export async function POST(request: NextRequest) {
  let focus = "";
  let force = false;
  let requestedAt: string | undefined;
  try {
    const body = (await request.json()) as { focus?: unknown; force?: unknown; requestedAt?: unknown };
    if (typeof body.focus === "string") focus = body.focus;
    force = body.force === true;
    if (typeof body.requestedAt === "string") requestedAt = body.requestedAt;
  } catch {
    // Empty/invalid body is fine — defaults apply.
  }

  // The pack is dated in the autopilot's zone, as the Threads autopilot dates its own:
  // the server's clock zone can be a different day at 8 PM in Toronto.
  const { pack, cached, reason } = await ensureDailyPack({ focus, force, requestedAt, date: zonedDateKey(threadsConfig().timezone) });
  return NextResponse.json({ pack, cached, reason, configured: plannerConfigured() });
}
