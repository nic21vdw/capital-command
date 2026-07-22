import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio, videoIdeaSchema } from "@/lib/storage/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Updates an idea (status changes: save / archive / mark scripted, edits). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  const patch = (await request.json()) as Record<string, unknown>;

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const idea = studio.ideas.find((entry) => entry.id === ideaId);
  if (!idea) return NextResponse.json({ error: "Idea not found." }, { status: 404 });

  const parsed = videoIdeaSchema.safeParse({ ...idea, ...patch, id: idea.id, createdAt: idea.createdAt });
  if (!parsed.success) return NextResponse.json({ error: "Invalid idea update." }, { status: 400 });

  const nextStudio = { ...studio, ideas: studio.ideas.map((entry) => (entry.id === ideaId ? parsed.data : entry)) };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ idea: parsed.data });
}

/** Removes an idea from the board entirely. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  if (!studio.ideas.some((entry) => entry.id === ideaId)) {
    return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  }
  const nextStudio = { ...studio, ideas: studio.ideas.filter((entry) => entry.id !== ideaId) };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ ok: true });
}
