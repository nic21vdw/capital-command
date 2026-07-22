import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { windowSegments } from "@/lib/clipping/captions";
import { getJob } from "@/lib/clipping/jobs";
import { generatePlatformCopy } from "@/lib/publisher/ai-copy";
import { publisherConfig } from "@/lib/publisher/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().min(1),
  clipId: z.string().min(1),
  platform: z.enum(["youtube", "instagram", "tiktok", "facebook"]),
  title: z.string().optional()
});

/**
 * POST /api/publish/ai-copy — tailor a clip's caption + hashtags (and a
 * best-time hint) to one platform. Reads the clip's own transcript from its job
 * so the copy reflects what is actually said. Free on DeepSeek Flash; falls back
 * to a heuristic caption when AI is unavailable.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { jobId, clipId, platform, title } = parsed.data;

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "That clip job could not be found." }, { status: 404 });
  }
  const clip = job.clips.find((candidate) => candidate.id === clipId);
  const spokenText = clip
    ? windowSegments(job.sourceCaptions ?? [], clip.start, clip.end)
        .map((segment) => segment.text)
        .join(" ")
        .trim()
    : undefined;

  const config = publisherConfig();
  const copy = await generatePlatformCopy(
    { title: title?.trim() || clip?.title, topic: job.topic, spokenText },
    platform,
    config.timezone
  );

  return NextResponse.json({ copy });
}
