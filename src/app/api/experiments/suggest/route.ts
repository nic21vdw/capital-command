import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { windowSegments } from "@/lib/clipping/captions";
import { getJob } from "@/lib/clipping/jobs";
import { suggestVariants } from "@/lib/experiments/suggest";
import { MAX_VARIANTS } from "@/lib/experiments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().min(1),
  clipId: z.string().min(1),
  kind: z.enum(["title", "hook"]),
  base: z.string().min(1),
  count: z.number().int().min(1).max(MAX_VARIANTS - 1).optional()
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That is not a valid request." }, { status: 400 });
  const { jobId, clipId, kind, base, count } = parsed.data;

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "That clip job could not be found." }, { status: 404 });
  const clip = job.clips.find((candidate) => candidate.id === clipId);
  const transcript = clip
    ? windowSegments(job.sourceCaptions ?? [], clip.start, clip.end)
        .map((segment) => segment.text)
        .join(" ")
        .trim()
    : "";

  const variants = await suggestVariants({ kind, base, transcript, count: count ?? MAX_VARIANTS - 1 });
  if (!variants) return NextResponse.json({ variants: null, note: "No model answered, so type the variants yourself." });
  return NextResponse.json({ variants });
}
