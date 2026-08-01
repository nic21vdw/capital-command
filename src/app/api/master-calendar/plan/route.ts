import { NextRequest, NextResponse } from "next/server";
import { buildMasterCalendarEvents, todayKeyIn } from "@/lib/master-calendar/aggregate";
import { generateCalendarPlan } from "@/lib/master-calendar/planner";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { readAppData } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

/**
 * GET /api/master-calendar/plan?start=YYYY-MM-DD&days=14 — reads the same
 * aggregated calendar as /api/master-calendar for the window, then asks the AI
 * provider (free DeepSeek Flash by default) to propose gap-filling content,
 * drawing from the idea board. Falls back to a rule-based plan when AI is off.
 */
export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const startRaw = request.nextUrl.searchParams.get("start");
  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : 14;
  const startKey = startRaw && DATE_KEY_RE.test(startRaw) ? startRaw : todayKeyIn(config.timezone);

  const [data, queueItems] = await Promise.all([
    readAppData(),
    config.enabled ? publishQueue(config).list() : Promise.resolve([])
  ]);

  const events = buildMasterCalendarEvents({
    data,
    queueItems,
    timeZone: config.timezone,
    startKey,
    days
  });

  const plan = await generateCalendarPlan({
    events,
    ideas: data.videoStudio?.ideas ?? [],
    startKey,
    days
  });

  return NextResponse.json({ start: startKey, days, timezone: config.timezone, plan });
}
