import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { generateScript, scriptGenerationConfigured } from "@/lib/studio/scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes a full script from an idea on the board (ideaId) or a bare
 * title/topic, following the stored script framework. The script is saved and
 * the source idea (when there is one) is marked `scripted`.
 */
export async function POST(request: NextRequest) {
  let ideaId = "";
  let title = "";
  let targetMinutes = 8;
  try {
    const body = (await request.json()) as { ideaId?: unknown; title?: unknown; targetMinutes?: unknown };
    if (typeof body.ideaId === "string") ideaId = body.ideaId;
    if (typeof body.title === "string") title = body.title.trim();
    const minutes = Number(body.targetMinutes);
    if (Number.isFinite(minutes)) targetMinutes = Math.max(1, Math.min(180, Math.round(minutes)));
  } catch {
    // Defaults apply.
  }

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const idea = ideaId ? studio.ideas.find((entry) => entry.id === ideaId) : undefined;
  if (ideaId && !idea) return NextResponse.json({ error: "That idea is no longer on the board." }, { status: 404 });
  if (!idea && !title) return NextResponse.json({ error: "Give the script a title or pick an idea." }, { status: 400 });

  const { script, reason } = await generateScript({
    framework: studio.framework,
    title: idea?.title ?? title,
    idea,
    targetMinutes
  });

  const nextStudio = {
    ...studio,
    scripts: [script, ...studio.scripts],
    ideas: idea
      ? studio.ideas.map((entry) => (entry.id === idea.id ? { ...entry, status: "scripted" as const } : entry))
      : studio.ideas
  };
  await writeAppData({ ...data, videoStudio: nextStudio });

  return NextResponse.json({ script, reason, configured: scriptGenerationConfigured() });
}
