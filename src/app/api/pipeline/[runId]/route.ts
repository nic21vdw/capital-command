import { NextRequest, NextResponse } from "next/server";
import { deleteRun, getRun, reviseRun, runOverview, type PipelineRevision } from "@/lib/pipeline/runs";

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
 * PATCH /api/pipeline/<runId> — edit a run at one of its two gates and, with
 * `approve`, let it past. `approve: "plan"` starts the fetch; `approve:
 * "outputs"` starts the renders. The response is the joined overview, so the
 * page can repaint from one round trip.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  let revision: PipelineRevision;
  try {
    revision = (await request.json()) as PipelineRevision;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const revised = await reviseRun(runId, revision);
    if (!revised) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    return NextResponse.json(await runOverview(revised));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the run." },
      { status: 400 }
    );
  }
}

/** Removes the run record only — its outputs stay in their own tools. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  await deleteRun(runId);
  return NextResponse.json({ ok: true });
}
