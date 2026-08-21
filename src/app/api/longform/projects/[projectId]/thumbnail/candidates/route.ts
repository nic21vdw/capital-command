import { NextRequest, NextResponse } from "next/server";
import { buildThumbnailCandidates, readThumbnailCandidates } from "@/lib/longform/thumbnail";
import { getProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const topicId = request.nextUrl.searchParams.get("topicId");
  const manifest = await readThumbnailCandidates(projectId, topicId);
  return NextResponse.json({ candidates: manifest });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "No such video." }, { status: 404 });
  if (project.status !== "ready") {
    return NextResponse.json({ error: "This video is still being processed." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { topicId?: string };
  const manifest = await buildThumbnailCandidates(project, body.topicId ?? null);
  if (!manifest) {
    return NextResponse.json({ error: "No usable frames were found in this video." }, { status: 422 });
  }
  return NextResponse.json({ candidates: manifest });
}
