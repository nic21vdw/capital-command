import { NextRequest, NextResponse } from "next/server";
import { plannerConfigured } from "@/lib/x-posts/generator";
import { ensureDailyPack } from "@/lib/x-posts/daily";
import { threadsBlockedReason, threadsConfig } from "@/lib/threads/config";
import { planTodaysBatch } from "@/lib/threads/daily";
import { readQueue } from "@/lib/threads/queue";
import { rewriteDecision } from "@/lib/threads/rewrite";
import { zonedDateKey } from "@/lib/threads/zone";
import { isAutomationPaused } from "@/lib/automations/store";
import type { ThreadsPlanResult } from "@/lib/threads/types";

/**
 * Returns today's X/Threads pack, generating it on first request of the day
 * (or on demand with `force`). Suggestion-only: this route never records
 * anything about what actually got posted - see /api/threads for the autopilot
 * that schedules the pack onto Threads.
 *
 * `force` REWRITES the pack, and the queue holds its own copy of every post, so
 * a rewrite is only allowed when it can keep the two the same (see
 * `rewriteDecision`): once any of today's posts has started going out the pack
 * is frozen (409), and otherwise the posts still waiting are swapped for the new
 * pack's before this answers. A rewrite can therefore never queue a slot that
 * has already been sent.
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
    // Empty/invalid body is fine - defaults apply.
  }

  // The pack is dated in the autopilot's zone, as the Threads autopilot dates its own:
  // the server's clock zone can be a different day at 8 PM in Toronto.
  const config = threadsConfig();
  const date = zonedDateKey(config.timezone);

  let replaces = 0;
  if (force) {
    const decision = rewriteDecision({
      packExists: true,
      items: await readQueue(),
      date,
      autopilot: { paused: await isAutomationPaused("threads"), blockedReason: threadsBlockedReason(config), noAccount: config.accounts.length === 0 }
    });
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason, blocked: true, counts: decision.counts }, { status: 409 });
    }
    replaces = decision.replaces;
  }

  const { pack, cached, reason } = await ensureDailyPack({ focus, force, requestedAt, date, keepWritten: true });

  // The new pack is written; make the queue say the same. Planning reads the pack
  // just stored (no second model call) and keeps every row that has started.
  let queue: { replaced: number; plan?: ThreadsPlanResult; error?: string } | undefined;
  if (force && !cached && replaces > 0) {
    try {
      queue = { replaced: replaces, plan: await planTodaysBatch({ config, replacePending: true }) };
    } catch (error) {
      queue = { replaced: replaces, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return NextResponse.json({ pack, cached, reason, configured: plannerConfigured(), ...(queue ? { queue } : {}) });
}
