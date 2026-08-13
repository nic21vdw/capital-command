import { NextRequest, NextResponse } from "next/server";
import { stampProjectSignature } from "@/lib/clipping/project-payload";
import { readAppData } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clip-projects/<id> — one clip project WITH its captions.
 *
 * The app-data payload ships every project without them (they are half of what
 * the browser used to download), so this is how the editor gets the whole
 * project for the one it is about to open. Captions can be split, merged and
 * re-timed by hand, so they cannot be rebuilt from the job transcript — this
 * reads the stored copy rather than deriving anything.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await readAppData();
  const project = (data.clipProjects ?? []).find((candidate) => candidate.id === id);
  if (!project) {
    return NextResponse.json({ error: "Clip project not found." }, { status: 404 });
  }
  return NextResponse.json({ project: stampProjectSignature(project) });
}
