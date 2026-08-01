import { NextRequest, NextResponse } from "next/server";
import { plannerConfigured } from "@/lib/x-posts/generator";
import { ensureDailyPack } from "@/lib/x-posts/daily";

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

  const { pack, cached, reason } = await ensureDailyPack({ focus, force, requestedAt });
  return NextResponse.json({ pack, cached, reason, configured: plannerConfigured() });
}
