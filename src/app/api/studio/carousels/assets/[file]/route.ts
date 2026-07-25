import { NextResponse } from "next/server";
import { readCarouselAsset } from "@/lib/carousels/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const bytes = await readCarouselAsset(file);
  if (!bytes) return NextResponse.json({ error: "Carousel image not found." }, { status: 404 });

  const extension = file.split(".").pop()?.toLowerCase();
  const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
