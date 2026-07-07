import { NextRequest, NextResponse } from "next/server";
import { deleteOverlayImage, readOverlayImage } from "@/lib/longform/overlays";
import { getProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; imageId: string }> };

/** Serves a timeline overlay image by its overlay id. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, imageId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const overlay = project.overlays.find((item) => item.id === imageId);
  if (!overlay) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  const data = await readOverlayImage(projectId, overlay.storedName);
  if (!data) return NextResponse.json({ error: "Image file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": overlay.mime || "image/png",
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600"
    }
  });
}

/** Removes an overlay's image file. The overlay record itself is dropped by
 * the client through the project PATCH. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId, imageId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  await deleteOverlayImage(projectId, imageId);
  return NextResponse.json({ ok: true });
}
