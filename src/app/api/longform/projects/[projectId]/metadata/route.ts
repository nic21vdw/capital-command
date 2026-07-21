import { NextRequest, NextResponse } from "next/server";
import { generateLongformMetadata, longformMetadataConfigured } from "@/lib/longform/metadata";
import { getProject, updateProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates publish-ready titles/description/tags for the project and saves
 * them on it. Every call writes a fresh set, so "Regenerate" just POSTs again.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const metadata = await generateLongformMetadata(project);
  await updateProject(projectId, { metadata });
  return NextResponse.json({ metadata, configured: longformMetadataConfigured() });
}
