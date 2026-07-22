import { NextRequest, NextResponse } from "next/server";
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

/** Removes the run record only — its outputs stay in their own tools. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  await deleteRun(runId);
  return NextResponse.json({ ok: true });
}
