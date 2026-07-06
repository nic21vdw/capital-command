import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { startLongformExport } from "@/lib/longform/render";
import { getProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ exports: project.exports });
}

export async function POST(_request: NextRequest, { params }: Params) {
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  try {
    const record = await startLongformExport(project);
    return NextResponse.json({ export: record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
