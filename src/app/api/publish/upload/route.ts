import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabled";
import { enqueue } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";
import { runDue, type RunReport } from "@/lib/publisher/runner";
import { deleteUpload, saveUploadFromStream } from "@/lib/publisher/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The video streams in, may re-render vertical, then streams up to YouTube.
export const maxDuration = 300;

const paramsSchema = z.object({
  name: z.string().min(1),
  publishAt: z.string().min(1),
  platform: z.enum(["youtube", "instagram", "tiktok", "facebook"]),
  accountId: z.string().min(1).optional()
});

/**
 * POST /api/publish/upload — schedule a video that never went through the
 * clip generator: the raw file body streams to disk (filename/platform/slot
 * arrive as query params so nothing is buffered for multipart parsing), then
 * it's enqueued exactly like a dropped clip — vertical re-render, generated
 * metadata, and the immediate YouTube upload all included.
 */
export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "No file body received." }, { status: 400 });
  }

  const parsed = paramsSchema.safeParse({
    name: request.nextUrl.searchParams.get("name")?.trim() || "upload.mp4",
    publishAt: request.nextUrl.searchParams.get("publishAt"),
    platform: request.nextUrl.searchParams.get("platform"),
    accountId: request.nextUrl.searchParams.get("accountId") || undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }
  const { name, publishAt, platform, accountId } = parsed.data;

  let saved;
  try {
    saved = await saveUploadFromStream(request.body, name, request.headers.get("content-type") || "video/mp4");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 }
    );
  }

  let item;
  try {
    item = await enqueue({
      clipPath: saved.path,
      publishAt,
      platforms: [platform],
      // "public" is what makes YouTube honor publishAt (uploaded private,
      // flipped live at the slot time) — same as scheduling a clip.
      visibility: "public",
      accountId,
      metadataSource: { streamTitle: name }
    });
  } catch (error) {
    await deleteUpload(saved.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  let report: RunReport | undefined;
  try {
    report = await runDue(new Date(), { itemId: item.id });
  } catch (error) {
    console.warn(
      `[publisher] immediate run for ${item.id} failed (the scheduler will retry): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // Re-read so the response carries the post-upload platform states.
  const savedItem = await publishQueue(config).get(item.id);
  return NextResponse.json({ item: savedItem ?? item, report }, { status: 201 });
}
