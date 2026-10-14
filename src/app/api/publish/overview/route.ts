import { NextRequest, NextResponse } from "next/server";
import { isAutomationPaused } from "@/lib/automations/store";
import { readAutomationTasks } from "@/lib/automations/tasks";
import { platformCopyConfigured } from "@/lib/publisher/ai-copy";
import { publisherConfig } from "@/lib/publisher/config";
import type { PublisherAutomationOverview } from "@/lib/publisher/publishOverview";
import { shortsLimit } from "@/lib/publisher/shortsCap";
import { listeningUnitsToday } from "@/lib/listening/ledger";
import { youtubeQuota } from "@/lib/publisher/quota";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots, slotGrid } from "@/lib/publisher/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far the schedule grid can page from today, in either direction: ten years. */
const MAX_OFFSET_DAYS = 3650;

/**
 * GET /api/publish/overview?days=14&offsetDays=0 — whether publishing is on,
 * the YouTube quota meter, and the schedule grid slots (built server-side so
 * wall-clock labels are in PUBLISH_TIMEZONE and instants are UTC).
 * `offsetDays` moves the slot window relative to today so the UI can page
 * through past and future scheduling periods (negative = earlier).
 *
 * Everything here is read from local config, the queue file, the automation
 * pause switch and (on Windows) the scheduled-task registry — no social
 * network is contacted. Who each account posts as lives on
 * /api/publish/accounts, which is where the UI reads it from; this route used
 * to report the same profiles again from four live API calls that the whole
 * app then ignored.
 *
 * `slotsOnly=1` answers with just the grid — for callers that only want
 * somewhere to put a video (the editor's Schedule Short menu). The Uploading
 * Center is NOT one of them: `generateSlots` is pure arithmetic over the
 * timezone and the offset, so its calendar builds the grid in the browser and
 * paging costs no request at all.
 */
/** Whether the publisher is paused and whether its runner is installed — read-only. */
async function publisherAutomation(): Promise<PublisherAutomationOverview> {
  const [paused, tasks] = await Promise.all([
    isAutomationPaused("publisher"),
    readAutomationTasks().catch(() => ({}))
  ]);
  const task = (tasks as Awaited<ReturnType<typeof readAutomationTasks>>).publisher;
  return {
    paused,
    task: {
      state: task?.state ?? "unknown",
      lastRunAt: task?.lastRunAt ?? null,
      nextRunAt: task?.nextRunAt ?? null
    }
  };
}

export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 60) : 14;
  const offsetRaw = Number(request.nextUrl.searchParams.get("offsetDays"));
  const offsetDays = Number.isFinite(offsetRaw)
    ? Math.max(-MAX_OFFSET_DAYS, Math.min(Math.trunc(offsetRaw), MAX_OFFSET_DAYS))
    : 0;

  const now = new Date();

  if (request.nextUrl.searchParams.get("slotsOnly") === "1") {
    const slots = generateSlots({
      timeZone: config.timezone,
      days,
      startDayOffset: offsetDays,
      now,
      ...slotGrid(config)
    });
    return NextResponse.json({ enabled: config.enabled, timezone: config.timezone, slotOffsetDays: offsetDays, slots });
  }

  // Read even while posting is off: the quota meter should show what YouTube
  // already holds, and listing the queue changes nothing.
  const items = await publishQueue(config).list();

  return NextResponse.json({
    enabled: config.enabled,
    timezone: config.timezone,
    // The grid the SERVER will book on. The Uploading Center pages through
    // slots without a request, so it has to be told the times rather than
    // assuming the defaults — a client drawing three slots a day against a
    // server booking six shows gaps that are not there.
    slotTimes: config.slotTimes,
    weekendSlotTimes: config.weekendSlotTimes,
    // The cap enqueue() enforces per local day (PUBLISH_SHORTS_PER_DAY), so the
    // screen can plan around it instead of discovering it one refusal at a time.
    shortsPerDay: shortsLimit(config),
    // The YouTube lead's copy onto Instagram and Facebook, which is on by default.
    mirror: { enabled: config.mirror.enabled, lead: config.mirror.lead, targets: config.mirror.targets },
    automation: await publisherAutomation(),
    // Whether a model can write captions here, as a boolean only (never a key
    // or a provider name), so the bulk panel can say what "Schedule" will do
    // about captions instead of promising an AI that is not there.
    aiCopyAvailable: platformCopyConfigured(),
    quota: youtubeQuota(items, now, config, await listeningUnitsToday(now))
  });
}
