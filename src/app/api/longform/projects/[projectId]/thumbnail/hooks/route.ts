import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/longform/store";
import { thumbnailHooks } from "@/lib/longform/thumbnailHooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { topicId?: string };
  const ideas = await thumbnailHooks(project, body.topicId ?? null);
  return NextResponse.json(ideas);
}
