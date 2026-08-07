import { NextRequest, NextResponse } from "next/server";
import { dismissQueueFailures, planRunOutputs, queueRunOutputs } from "@/lib/pipeline/queueOutputs";
import { queueRunPosts } from "@/lib/pipeline/queuePosts";
import { renderNextSegment, repairRun } from "@/lib/pipeline/repair";
import { isRepairableStage } from "@/lib/pipeline/repairable";
import { deleteRun, getRun, runOverview, updateRun } from "@/lib/pipeline/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  return NextResponse.json(await runOverview(run));
}

/**
 * POST /api/pipeline/<runId> — start work on a run again.
 *   { stage: "longform" | … }   run that stage again
 *   { action: "segment" }       render the next planned topic segment
 *
 * Answers with the fresh overview, so the row the button is on updates from the
 * reply rather than waiting for the next poll.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { stage?: unknown; action?: unknown } | null;
  const stage = typeof body?.stage === "string" ? body.stage : "";
  const action = typeof body?.action === "string" ? body.action : "";

  // What would be booked, and what is already booked — read before confirming.
  if (action === "plan-queue") {
    const plan = await planRunOutputs(runId);
    if (!plan) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    return NextResponse.json({ plan });
  }

  if (action === "queue-all") {
    const ids = Array.isArray((body as { ids?: unknown })?.ids)
      ? ((body as { ids: unknown[] }).ids.filter((id) => typeof id === "string") as string[])
      : undefined;
    try {
      const result = await queueRunOutputs(runId, ids);
      // Everything he ticked, plus whatever this run has not finished yet: the
      // segments render for hours after this click and the long-form export
      // often lands after the shorts.
      const keepGoing = (body as { keepGoing?: unknown })?.keepGoing !== false;
      if (keepGoing && result.queued.length > 0) await updateRun(run, { queueWhenReady: true });
      const detail = `${result.queued.length} scheduled${
        result.failed.length > 0 ? ` · ${result.failed.length} could not be` : ""
      }${keepGoing ? " · anything still rendering is booked as it lands" : ""}.`;
      return NextResponse.json({ detail, ...result, overview: await runOverview(run) });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Nothing could be scheduled." },
        { status: 409 }
      );
    }
  }

  // A booking that will never work — a deck he is not going to rebuild, a slot
  // that is never coming free — is his to put down, so the alarm does not
  // outlive his decision about it.
  if (action === "dismiss-failures") {
    const dismissed = await dismissQueueFailures(runId);
    if (!dismissed) {
      return NextResponse.json({ error: "Nothing on this run is flagged as unbooked." }, { status: 409 });
    }
    return NextResponse.json({
      detail: "Cleared. Anything that fails again is flagged again.",
      overview: await runOverview(run)
    });
  }

  // The standing instruction is his to end, from the row it runs on.
  if (action === "stop-queueing") {
    await updateRun(run, { queueWhenReady: undefined, unattended: undefined });
    return NextResponse.json({ detail: "Nothing more will be booked automatically.", overview: await runOverview(run) });
  }

  if (action === "queue-posts") {
    try {
      const result = await queueRunPosts(runId);
      return NextResponse.json({
        detail: `${result.scheduled} post${result.scheduled === 1 ? "" : "s"} scheduled${
          result.note ? ` · ${result.note}` : ""
        }.`,
        overview: await runOverview(run)
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Those posts could not be scheduled." },
        { status: 409 }
      );
    }
  }

  if (action === "segment" || action === "segments-all") {
    const all = action === "segments-all";
    const result = await renderNextSegment(runId, all);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({
      detail: all
        ? `Rendering all of them, one at a time — ${result.remaining + 1} to go.`
        : `Rendering "${result.title}"${result.remaining > 0 ? ` · ${result.remaining} still to render` : ""}.`,
      overview: await runOverview(run)
    });
  }

  // "Everything that is stuck" — one click for a run that broke in three
  // places. Each repair is the same one a single button performs, run in order,
  // and a stage that refuses does not stop the rest.
  if (action === "retry-all") {
    const overview = await runOverview(run);
    const stuck = overview.retryable;
    if (stuck.length === 0) return NextResponse.json({ error: "Nothing on this run needs retrying." }, { status: 409 });
    const started: string[] = [];
    const refused: string[] = [];
    for (const item of stuck) {
      if (!isRepairableStage(item.stage)) continue;
      const result = await repairRun(runId, item.stage);
      if (result.ok) started.push(item.stage);
      else refused.push(`${item.stage}: ${result.error}`);
    }
    if (started.length === 0) {
      return NextResponse.json({ error: refused[0] ?? "None of those stages could be started again." }, { status: 409 });
    }
    return NextResponse.json({
      detail: `Started ${started.length} stage${started.length === 1 ? "" : "s"} again${
        refused.length > 0 ? ` · ${refused.length} could not be` : ""
      }.`,
      refused,
      overview: await runOverview(run)
    });
  }

  if (!isRepairableStage(stage)) {
    return NextResponse.json({ error: `There is nothing to retry called "${stage}".` }, { status: 400 });
  }

  const result = await repairRun(runId, stage);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ detail: result.detail, overview: await runOverview(run) });
}

/** Removes the run record only — its outputs stay in their own tools. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  await deleteRun(runId);
  return NextResponse.json({ ok: true });
}
