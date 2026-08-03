import { NextResponse } from "next/server";
import { readReleaseStatus } from "@/lib/release/status";
import { isReleaseInFlight, startRelease } from "@/lib/release/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readReleaseStatus();
  return NextResponse.json({ ...status, updating: isReleaseInFlight() });
}

export async function POST() {
  const status = await readReleaseStatus();

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

  const result = startRelease();
  if (!result.started) {
    return NextResponse.json({ error: result.reason ?? "Could not start the update." }, { status: 409 });
  }

  return NextResponse.json({ started: true, releasing: status.latestShort });
}
