import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { checkAvatarVideoJob } from "@/lib/higgsfield/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polls Higgsfield for this job's status and persists any update. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await readAppData();
  const avatarVideos = data.avatarVideos ?? [];
  const record = avatarVideos.find((entry) => entry.id === id);
  if (!record) return NextResponse.json({ error: "Avatar video not found." }, { status: 404 });

  if (record.status !== "processing" || !record.externalJobId) {
    return NextResponse.json({ avatarVideo: record });
  }

  const result = await checkAvatarVideoJob(record.externalJobId);
  const updated =
    result.status === "processing"
      ? record
      : {
          ...record,
          status: result.status,
          videoUrl: result.videoUrl ?? record.videoUrl,
          thumbnailUrl: result.thumbnailUrl ?? record.thumbnailUrl,
          error: result.error,
          updatedAt: new Date().toISOString()
        };

  if (updated !== record) {
    await writeAppData({ ...data, avatarVideos: avatarVideos.map((entry) => (entry.id === id ? updated : entry)) });
  }
  return NextResponse.json({ avatarVideo: updated });
}

/** Deletes an avatar video record. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await readAppData();
  const avatarVideos = data.avatarVideos ?? [];
  if (!avatarVideos.some((entry) => entry.id === id)) {
    return NextResponse.json({ error: "Avatar video not found." }, { status: 404 });
  }
  await writeAppData({ ...data, avatarVideos: avatarVideos.filter((entry) => entry.id !== id) });
  return NextResponse.json({ ok: true });
}
