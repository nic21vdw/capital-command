import { NextRequest, NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { runDue } from "@/lib/publisher/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Instagram/TikTok processing can poll for a few minutes.
export const maxDuration = 300;

/**
 * POST /api/publish/run — process everything due right now.
 * Body: { "dryRun": true } to validate auth and print the plan without posting.
 */
export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }
  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: boolean };
    dryRun = Boolean(body?.dryRun);
  } catch {
    // Empty body — a real run.
  }
  const report = await runDue(new Date(), { dryRun });
  return NextResponse.json({ report });
}
