import { NextResponse } from "next/server";
import { bookingsByCarousel } from "@/lib/carousels/booked";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio/carousels/booked - which carousels already have a post in the
 * publish queue, keyed by carousel id, with the time zone to read them in. Read
 * only: it lists the queue and changes nothing.
 */
export async function GET() {
  const config = publisherConfig();
  try {
    const items = await publishQueue(config).list();
    return NextResponse.json({ timeZone: config.timezone, bookings: bookingsByCarousel(items) });
  } catch {
    // The chip is a convenience; a queue that cannot be read must not break the page.
    return NextResponse.json({ timeZone: config.timezone, bookings: {} });
  }
}
