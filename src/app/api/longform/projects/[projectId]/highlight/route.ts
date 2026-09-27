import { NextRequest, NextResponse } from "next/server";
import { fixedChapters } from "@/lib/longform/metadata";
import { highlightRuntimeSec } from "@/lib/longform/highlights";
import { longformHighlightBuildSchema, longformHighlightPatchSchema } from "@/lib/longform/schemas";
import {
  clearHighlightEdit,
  getProject,
  startHighlightEdit,
  updateHighlightPassages
} from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/** The edit as the editor shows it: the plan, what it runs to, and its chapters. */
function payload(project: LongformProject) {
  return {
    highlight: project.highlight ?? null,
    build: project.highlightBuild ?? null,
    runtimeSec: project.highlight ? highlightRuntimeSec(project.highlight, project.segments) : null,
    chapters: fixedChapters(project),
    project
  };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json(payload(project));
}

/**
 * Starts building (or rebuilding) the best-of edit at the requested runtime.
 * Returns at once with `highlightBuild` running; the editor polls GET.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = longformHighlightBuildSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected an optional `targetMinutes` between 8 and 60." }, { status: 400 });
  }
  try {
    const targetSec = parsed.data.targetMinutes ? Math.round(parsed.data.targetMinutes * 60) : undefined;
    const project = await startHighlightEdit(projectId, { targetSec });
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json(payload(project), { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build the best-of edit." },
      { status: 409 }
    );
  }
}

/** Swaps passages in or out, or renames their chapters. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = longformHighlightPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected `passages`: [{ id, enabled?, label? }]." }, { status: 400 });
  }
  try {
    const project = await updateHighlightPassages(projectId, parsed.data.passages);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json(payload(project));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change the edit." },
      { status: 409 }
    );
  }
}

/** Goes back to the whole recording with its dead space cut. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await clearHighlightEdit(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json(payload(project));
}
