import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import { outputDir } from "@/lib/clipping/jobs";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueue } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/publish — the queue with per-platform status. */
export async function GET() {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ enabled: false, items: [] });
  }
  const items = await publishQueue(config).list();
  return NextResponse.json({ enabled: true, items });
}

const enqueueSchema = z.object({
  // Either a jobId + file (a clip rendered/exported by the clipper) …
  jobId: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  // … or an explicit path relative to the project root.
  clipPath: z.string().min(1).optional(),
  publishAt: z.string().min(1),
  title: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  hashtags: z.array(z.string()).optional(),
  platforms: z.array(z.enum(["youtube", "instagram", "tiktok"])).optional(),
  visibility: z.enum(["public", "private", "unlisted"]).optional()
});

/** POST /api/publish — enqueue a finished clip for scheduled publishing. */
export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }

  let body;
  try {
    body = enqueueSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid enqueue request." }, { status: 400 });
  }

  let clipPath = body.clipPath;
  if (!clipPath && body.jobId && body.file) {
    // Only allow files that actually live inside the job's output folder.
    const base = outputDir(body.jobId);
    const resolved = path.resolve(base, body.file);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) {
      return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
    }
    clipPath = resolved;
  }
  if (!clipPath) {
    return NextResponse.json({ error: "Provide either clipPath or jobId + file." }, { status: 400 });
  }

  try {
    const item = await enqueue({
      clipPath,
      publishAt: body.publishAt,
      title: body.title,
      caption: body.caption,
      hashtags: body.hashtags,
      platforms: body.platforms,
      visibility: body.visibility,
      jobId: body.jobId
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
