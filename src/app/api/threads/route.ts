import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAllAccounts } from "@/lib/threads/api";
import { threadsBlockedReason, threadsConfig, threadsConfigured, unassignedVersions } from "@/lib/threads/config";
import { planTodaysBatch, threadsTick } from "@/lib/threads/daily";
import { mutateQueue, readQueue, summarizeBatch, summarizeBatches } from "@/lib/threads/queue";
import { runDue } from "@/lib/threads/runner";
import { localDateKey } from "@/lib/x-strategy/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A tick can plan a batch (one model call) and post several items. */
export const maxDuration = 300;

/**
 * The Threads autopilot's HTTP face.
 *
 * The queue lives in a file that the app owns, so the scheduled task drives
 * everything through here rather than importing the queue into a second
 * process — the same rule the Stream Pipeline learned the hard way.
 *
 * GET is read-only: it reports, it never posts. All the acting is POST.
 */

/** GET /api/threads — autopilot status, today's tally and the queue. */
export async function GET() {
  const config = threadsConfig();
  const items = await readQueue();
  const today = localDateKey();
  return NextResponse.json({
    enabled: config.enabled,
    configured: threadsConfigured(config),
    blockedReason: threadsBlockedReason(config),
    settings: {
      timezone: config.timezone,
      postsPerDay: config.postsPerDay,
      lateGraceMinutes: config.lateGraceMinutes,
      // Credentials never leave the server — only what the dashboard shows.
      accounts: config.accounts.map((account) => ({
        id: account.id,
        label: account.label,
        posts: account.posts,
        offsetMinutes: account.offsetMinutes
      })),
      unassignedVersions: unassignedVersions(config)
    },
    today: summarizeBatch(items, today),
    batches: summarizeBatches(items),
    items
  });
}

const actionSchema = z.object({
  action: z.enum(["tick", "plan", "run-due", "check", "skip", "remove"]),
  force: z.boolean().optional(),
  focus: z.string().optional(),
  dryRun: z.boolean().optional(),
  id: z.string().min(1).optional()
});

/**
 * POST /api/threads — drive the autopilot.
 *
 *   tick     plan today's batch if it isn't scheduled yet, then post what's due
 *            (what the scheduled task calls every few minutes)
 *   plan     schedule today's batch only; `force` regenerates the pack
 *   run-due  post what's due only; `dryRun` reports without posting
 *   check    validate the Threads token without posting
 *   skip     take one queued post out of the running
 *   remove   delete one queued post outright
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with an action." }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { action, force, focus, dryRun, id } = parsed.data;
  const config = threadsConfig();

  try {
    if (action === "check") {
      const blocked = threadsBlockedReason(config);
      if (blocked) return NextResponse.json({ ok: false, error: blocked }, { status: 400 });
      const checks = await checkAllAccounts(config);
      return NextResponse.json({ ok: checks.every((check) => check.ok), checks });
    }

    if (action === "plan") {
      return NextResponse.json({ plan: await planTodaysBatch({ config, force, focus }) });
    }

    if (action === "run-due") {
      return NextResponse.json({ run: await runDue(new Date(), { config, dryRun }) });
    }

    if (action === "tick") {
      const { plan, run } = await threadsTick({ config, dryRun });
      return NextResponse.json({ plan, run });
    }

    if (!id) return NextResponse.json({ error: `"${action}" needs the id of a queued post.` }, { status: 400 });

    if (action === "skip") {
      const found = await mutateQueue((items) => {
        const item = items.find((entry) => entry.id === id);
        if (item && item.status === "pending") {
          item.status = "skipped";
          item.note = "Skipped by hand from the dashboard.";
          delete item.claimedAt;
        }
        return { items, result: Boolean(item) };
      });
      if (!found) return NextResponse.json({ error: "No such queued post." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const removed = await mutateQueue((items) => {
      const next = items.filter((entry) => entry.id !== id);
      return { items: next, result: next.length !== items.length };
    });
    if (!removed) return NextResponse.json({ error: "No such queued post." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
