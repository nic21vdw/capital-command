import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { ensureClipThumbnail } from "@/lib/clipping/thumbnails";
import { ensureProjectPoster } from "@/lib/longform/poster";
import { getProject, projectOutputDir } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const exportId = request.nextUrl.searchParams.get("exportId");
  const poster = exportId ? await exportPoster(projectId, exportId) : await ensureProjectPoster(project);
  if (!poster) {
    return NextResponse.json({ error: "No frame could be read from this video yet." }, { status: 404 });
  }

  const size = (await stat(poster.path)).size;
  const stream = Readable.toWeb(createReadStream(poster.path)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[path.extname(poster.path).toLowerCase()] ?? "image/jpeg",
      "Content-Length": String(size),
      "X-Poster-Kind": poster.kind,
      "Cache-Control": "private, max-age=3600"
    }
  });
}

async function exportPoster(projectId: string, exportId: string) {
  const project = await getProject(projectId);
  const record = project?.exports.find((item) => item.id === exportId);
  if (!record || record.status !== "done" || !record.file) return null;

  const outputDir = projectOutputDir(projectId);
  if (record.thumbnailFile) {
    const generated = path.join(outputDir, record.thumbnailFile);
    if (path.resolve(generated).startsWith(path.resolve(outputDir))) {
      try {
        if ((await stat(generated)).size > 0) return { path: generated, kind: "generated" as const };
      } catch {
        // Fall through to the frame grabbed from the rendered file.
      }
    }
  }
  const poster = await ensureClipThumbnail(outputDir, record.file);
  return poster ? { path: poster, kind: "export" as const } : null;
}
