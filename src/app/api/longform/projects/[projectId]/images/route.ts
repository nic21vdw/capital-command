import { NextRequest, NextResponse } from "next/server";
import { saveOverlayImage } from "@/lib/longform/overlays";
import { getProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Images stream to disk; allow headroom for large uploads.
export const maxDuration = 120;

type Params = { params: Promise<{ projectId: string }> };

/**
 * Uploads an image for a timeline overlay. Like the music upload, the request
 * body IS the file — the name arrives as a query param and the type as the
 * Content-Type header. The client owns the overlay record (position + timing)
 * and persists it through the project PATCH; this route only stores the file
 * and returns its identity.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const name = request.nextUrl.searchParams.get("name")?.trim() || "image.png";
  const type = request.headers.get("content-type") ?? "image/png";
  if (!type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files can be dropped on the timeline." }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "Attach the image as the request body." }, { status: 400 });
  }
  try {
    const image = await saveOverlayImage(projectId, request.body, name, type);
    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save that image." },
      { status: 500 }
    );
  }
}
