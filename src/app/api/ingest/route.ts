import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getIngestJob, ingestOverview, startIngestScan, summarizeJob } from "@/lib/ingest/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  dryRun: z.boolean().optional(),
  liveOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).optional(),
  lookbackDays: z.number().int().min(1).max(60).optional()
});

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getIngestJob(jobId);
    if (!job) return NextResponse.json({ error: "No such scan." }, { status: 404 });
    return NextResponse.json({ job: summarizeJob(job) });
  }
  return NextResponse.json(await ingestOverview());
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scan request." }, { status: 400 });
  const job = startIngestScan({ ...parsed.data, baseUrl: request.nextUrl.origin });
  return NextResponse.json({ job: summarizeJob(job) }, { status: 202 });
}
