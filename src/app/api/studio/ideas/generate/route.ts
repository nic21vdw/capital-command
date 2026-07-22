import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { generateIdeas, ideaResearchConfigured } from "@/lib/studio/ideas";
import { readOutlierStore } from "@/lib/youtube/outlier-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs one idea-research pass for a seed keyword. Fresh `suggested` ideas
 * replace the previous unsaved suggestions (saved/scripted/archived ideas are
 * untouched), so the board never silently grows stale suggestions.
 */
export async function POST(request: NextRequest) {
  let seed = "";
  try {
    const body = (await request.json()) as { seed?: unknown };
    if (typeof body.seed === "string") seed = body.seed;
  } catch {
    // Empty body is fine — an open research run.
  }

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;

  // Real niche demand signal: what's currently overperforming on the tracked
  // competitor channels (free — read from the local Outlier Radar store).
  let outlierTitles: string[] = [];
  try {
    const outliers = await readOutlierStore();
    outlierTitles = [...outliers.outliers]
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .map((outlier) => outlier.title)
      .slice(0, 20);
  } catch {
    // No outlier data — research runs without it.
  }

  const existingTitles = studio.ideas.filter((idea) => idea.status !== "archived").map((idea) => idea.title);

  const { ideas, reason } = await generateIdeas({ seed, outlierTitles, existingTitles });

  const kept = studio.ideas.filter((idea) => idea.status !== "suggested");
  const nextStudio = { ...studio, ideas: [...ideas, ...kept] };
  await writeAppData({ ...data, videoStudio: nextStudio });

  return NextResponse.json({ ideas, reason, configured: ideaResearchConfigured() });
}
