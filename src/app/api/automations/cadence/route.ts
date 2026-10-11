import { NextRequest, NextResponse } from "next/server";
import { allowsRequestOrigin } from "@/lib/request-origin";
import { checkCadenceInput } from "@/lib/automations/cadenceInput";
import { saveCadence } from "@/lib/automations/cadenceSave";
import { EnvWriteError } from "@/lib/envFile";
import { publisherConfig } from "@/lib/publisher/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shorts per day and the weekday/weekend slot times, written to .env and the
// running process. Nothing here touches the queue: existing bookings keep their
// times, and nothing is published.
export async function PATCH(request: NextRequest) {
  if (!allowsRequestOrigin(request)) return NextResponse.json({ error: "The cadence must be changed from this app." }, { status: 403 });
  const check = checkCadenceInput(await request.json().catch(() => null));
  if (!check.ok) return NextResponse.json({ error: check.problem }, { status: 400 });
  try {
    await saveCadence(check.value);
  } catch (error) {
    const message = error instanceof EnvWriteError ? error.message : "The cadence could not be saved.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const config = publisherConfig();
  return NextResponse.json({ shortsPerDay: config.shortsPerDay, slotTimes: config.slotTimes, weekendSlotTimes: config.weekendSlotTimes });
}
