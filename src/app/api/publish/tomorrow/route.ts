import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { deckDir, DECK_SLIDE_EXTENSION } from "@/lib/carousels/deckFiles";
import { listProjects } from "@/lib/longform/store";
import { publisherConfig } from "@/lib/publisher/config";
import { dateKeyOffset, summarizeDay } from "@/lib/publisher/daySummary";
import { buildPrepInventory } from "@/lib/publisher/prepInventory";
import { publishQueue } from "@/lib/publisher/queue";
import { readAppData } from "@/lib/storage/store";
import type { Carousel } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function deckIsRendered(carousel: Carousel): Promise<boolean> {
  try {
    const files = await fs.readdir(deckDir(carousel.id));
    return files.some((file) => file.toLowerCase().endsWith(DECK_SLIDE_EXTENSION));
  } catch {
    return false;
  }
}

/**
 * GET /api/publish/tomorrow — one day of the queue rolled up across platforms,
 * plus what is rendered and still unbooked.
 *
 * `?offset=` moves the day (0 = today, 1 = tomorrow, the default) so the same
 * endpoint answers "how did today go?" without a second route.
 */
export async function GET(request: NextRequest) {
  const config = publisherConfig();
  const offsetParam = Number(request.nextUrl.searchParams.get("offset") ?? "1");
  const offset = Number.isFinite(offsetParam) ? Math.trunc(offsetParam) : 1;

  if (!config.enabled) {
    return NextResponse.json({ enabled: false });
  }

  const items = await publishQueue(config).list();
  const dateKey = dateKeyOffset(new Date(), config.timezone, offset);
  const summary = summarizeDay(items, { dateKey, timeZone: config.timezone });

  const [projects, appData] = await Promise.all([listProjects(), readAppData()]);
  const carousels = appData.videoStudio?.carousels ?? [];
  const rendered = (
    await Promise.all(
      carousels.map(async (carousel) => ((await deckIsRendered(carousel)) ? carousel : null))
    )
  ).filter((carousel): carousel is Carousel => carousel !== null);

  return NextResponse.json({
    enabled: true,
    offset,
    summary,
    prep: buildPrepInventory({ queue: items, projects, renderedCarousels: rendered })
  });
}
