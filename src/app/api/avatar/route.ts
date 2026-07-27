import { NextRequest, NextResponse } from "next/server";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { avatarVideoSchema } from "@/lib/storage/schemas";
import { higgsfieldConfigured, submitAvatarVideoJob } from "@/lib/higgsfield/client";
import type { AvatarVideo } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kicks off a Higgsfield avatar-video generation job and saves the (pending) record. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Avatar video";
  if (!prompt) return NextResponse.json({ error: "Describe the scene you want the avatar in." }, { status: 400 });

  const record = avatarVideoSchema.parse({
    id: `avatar-${crypto.randomUUID()}`,
    title,
    prompt,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }) as AvatarVideo;

  const { externalJobId, error } = await submitAvatarVideoJob({ prompt });
  const finalRecord: AvatarVideo = externalJobId
    ? { ...record, status: "processing", externalJobId }
    : { ...record, status: "failed", error: error ?? "Could not submit the job." };

  const data = await readAppData();
  await writeAppData({ ...data, avatarVideos: [finalRecord, ...(data.avatarVideos ?? [])] });

  return NextResponse.json({ avatarVideo: finalRecord, configured: higgsfieldConfigured() });
}
