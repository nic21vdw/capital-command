import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { carouselSchema, defaultVideoStudio } from "@/lib/storage/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Edits a carousel (slide copy tweaks before rendering). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ carouselId: string }> }) {
  const { carouselId } = await params;
  const patch = (await request.json()) as Record<string, unknown>;

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  const carousel = studio.carousels.find((entry) => entry.id === carouselId);
  if (!carousel) return NextResponse.json({ error: "Carousel not found." }, { status: 404 });

  const parsed = carouselSchema.safeParse({ ...carousel, ...patch, id: carousel.id, createdAt: carousel.createdAt });
  if (!parsed.success) return NextResponse.json({ error: "Invalid carousel update." }, { status: 400 });

  const nextStudio = {
    ...studio,
    carousels: studio.carousels.map((entry) => (entry.id === carouselId ? parsed.data : entry))
  };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ carousel: parsed.data });
}

/** Deletes a carousel. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ carouselId: string }> }) {
  const { carouselId } = await params;
  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;
  if (!studio.carousels.some((entry) => entry.id === carouselId)) {
    return NextResponse.json({ error: "Carousel not found." }, { status: 404 });
  }
  const nextStudio = { ...studio, carousels: studio.carousels.filter((entry) => entry.id !== carouselId) };
  await writeAppData({ ...data, videoStudio: nextStudio });
  return NextResponse.json({ ok: true });
}
