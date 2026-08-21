import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { generatedThumbnailName } from "@/lib/longform/poster";
import { getProject, projectOutputDir, updateProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { exportId?: string; png?: string; hook?: string };
  const record = project.exports.find((item) => item.id === body.exportId);
  if (!record) {
    return NextResponse.json({ error: "That segment has not been rendered yet." }, { status: 404 });
  }

  const png = decodePng(body.png);
  if (!png) return NextResponse.json({ error: "The thumbnail image was not readable." }, { status: 400 });
  if (png.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "That thumbnail is too large to save." }, { status: 413 });
  }

  const fileName = generatedThumbnailName(record.id);
  const outputDir = projectOutputDir(projectId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, fileName), png);

  const updated = await updateProject(projectId, {
    exports: project.exports.map((item) =>
      item.id === record.id
        ? { ...item, thumbnailFile: fileName, thumbnailHook: body.hook?.trim() || undefined }
        : item
    )
  });
  return NextResponse.json({ export: updated?.exports.find((item) => item.id === record.id) ?? null });
}

function decodePng(dataUrl?: string): Buffer | null {
  if (!dataUrl) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1], "base64");
    return buffer.byteLength > 0 ? buffer : null;
  } catch {
    return null;
  }
}
