import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio, videoScriptSchema } from "@/lib/storage/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Updates a script: edited section content, accepted/dismissed production-kit
 * suggestions, title, status. The whole record (minus id/createdAt) is
 * patchable; zod keeps it well-formed.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await params;
  const patch = (await request.json()) as Record<string, unknown>;

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const script = studio.scripts.find((entry) => entry.id === scriptId);
  if (!script) return NextResponse.json({ error: "Script not found." }, { status: 404 });

  const parsed = videoScriptSchema.safeParse({
    ...script,
    ...patch,
    id: script.id,
    createdAt: script.createdAt,
    updatedAt: new Date().toISOString()
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid script update." }, { status: 400 });

  const nextStudio = { ...studio, scripts: studio.scripts.map((entry) => (entry.id === scriptId ? parsed.data : entry)) };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ script: parsed.data });
}

/** Deletes a script (the source idea drops back to `saved` so it isn't lost). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await params;
  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const script = studio.scripts.find((entry) => entry.id === scriptId);
  if (!script) return NextResponse.json({ error: "Script not found." }, { status: 404 });

  const nextStudio = {
    ...studio,
    scripts: studio.scripts.filter((entry) => entry.id !== scriptId),
    ideas: studio.ideas.map((idea) =>
      idea.id === script.ideaId && idea.status === "scripted" ? { ...idea, status: "saved" as const } : idea
    )
  };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ ok: true });
}
