import { NextResponse } from "next/server";
import { readReleaseStatus } from "@/lib/release/status";
import { isReleaseInFlight, startRelease } from "@/lib/release/run";
import { readReleaseProgress } from "@/lib/release/progress";
import { releaseStillRunning } from "@/lib/release/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [status, progress] = await Promise.all([readReleaseStatus(), readReleaseProgress()]);
  return NextResponse.json({
    ...status,
    updating: releaseStillRunning(isReleaseInFlight(), progress),
    progress
  });
}

export async function POST() {
  const [status, progress] = await Promise.all([readReleaseStatus(), readReleaseProgress()]);

  // A release that wrote down why it stopped is over, whatever the in-process
  // flag says. Without this the first failure locked the button out until the
  // server was restarted by hand — which is the one thing a broken release
  // makes hard.
  if (releaseStillRunning(isReleaseInFlight(), progress)) {
    return NextResponse.json({ error: "An update is already running." }, { status: 409 });
  }

  // The banner already hides the button in these cases; the route re-checks
  // because a POST is reachable without it, and releasing from a sandbox
  // worktree would merge dev into main from a checkout nobody meant to
  // release from.
  if (!status.releasable) {
    return NextResponse.json(
      { error: "Only the production checkout on main can release." },
      { status: 409 }
    );
  }
  if (!status.pending.length) {
    return NextResponse.json({ error: "There is nothing new to release." }, { status: 409 });
  }

  const result = startRelease(process.cwd(), { afterFailure: Boolean(progress.failed) });
  if (!result.started) {
    return NextResponse.json({ error: result.reason ?? "Could not start the update." }, { status: 409 });
  }

  return NextResponse.json({ started: true, releasing: status.latestShort });
}
