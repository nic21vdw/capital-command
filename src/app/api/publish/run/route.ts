import { NextRequest, NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabled";
import { withPublishRunLock } from "@/lib/publisher/runLock";
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
    return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });
  }
  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: boolean };
    dryRun = Boolean(body?.dryRun);
  } catch {
    // Empty body — a real run.
  }
  // A dry run posts nothing, so it never needs to wait on a real one.
  if (dryRun) {
    return NextResponse.json({ report: await runDue(new Date(), { dryRun: true }) });
  }
  const report = await withPublishRunLock(() => runDue(new Date(), { dryRun: false }));
  if (report === null) {
    return NextResponse.json({ skipped: true, reason: "A publish run is already in progress - leaving it alone this tick." });
  }
  return NextResponse.json({ report });
}
