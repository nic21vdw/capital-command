import { NextRequest, NextResponse } from "next/server";
import { renderNextSegment, repairRun } from "@/lib/pipeline/repair";
import { isRepairableStage } from "@/lib/pipeline/repairable";
import { deleteRun, getRun, runOverview } from "@/lib/pipeline/runs";

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

  if (action === "segment") {
    const result = await renderNextSegment(runId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({
      detail: `Rendering "${result.title}"${result.remaining > 0 ? ` · ${result.remaining} still to render` : ""}.`,
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
