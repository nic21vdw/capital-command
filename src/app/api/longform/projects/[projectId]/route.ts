import { NextRequest, NextResponse } from "next/server";
import { longformProjectPatchSchema } from "@/lib/longform/schemas";
import { deleteProject, getProject, retryAnalysis, updateProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = longformProjectPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project changes." }, { status: 400 });
  }
  const project = await updateProject(projectId, parsed.data);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ project });
}

/** POST retries a failed analysis. */
export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  try {
    const project = await retryAnalysis(projectId);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.status === "processing") {
    return NextResponse.json({ error: "This project is still being analyzed. Wait for it to finish." }, { status: 409 });
  }
  await deleteProject(projectId);
  return NextResponse.json({ ok: true });
}
