import { NextResponse } from "next/server";
import { manualCooldownMs, requestSync, syncInFlight } from "@/lib/analytics/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  const remainingMs = await manualCooldownMs(new Date()).catch(() => 0);
  if (syncInFlight()) return NextResponse.json({ started: false, running: true }, { status: 202, headers: NO_STORE });
  if (remainingMs > 0) {
    const retryAfterSeconds = Math.ceil(remainingMs / 1000);
    return NextResponse.json(
      { started: false, running: false, reason: "cooldown", retryAfterSeconds },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) } }
    );
  }
  const { started } = requestSync({ force: true, manual: true });
  return NextResponse.json({ started, running: true }, { status: 202, headers: NO_STORE });
}
