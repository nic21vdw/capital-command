import { NextRequest, NextResponse } from "next/server";
import { normalizeGroupLabel } from "@/lib/youtube/competitor-trends";
import { OutlierApiError, resolveChannel, youtubeConfigured } from "@/lib/youtube/outlier-service";
import { readOutlierStore, updateOutlierStore } from "@/lib/youtube/outlier-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/youtube/watchlist — CRUD for the channels the Outlier Radar monitors.
 * Separate from the connected channel's own publishing routes; stored in
 * data/youtube-outliers.json.
 */

function errorResponse(error: unknown) {
  if (error instanceof OutlierApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  const store = await readOutlierStore();
  return NextResponse.json({ channels: store.channels, configured: youtubeConfigured() });
}

/** POST { input } — channel URL, @handle, or UC… id. Resolves it (1-2 quota units) and adds it. */
export async function POST(request: NextRequest) {
  try {
    const { input } = (await request.json()) as { input?: string };
    if (typeof input !== "string" || !input.trim()) {
      return NextResponse.json({ error: "Provide a channel URL, @handle, or channel id." }, { status: 400 });
    }
    if (!youtubeConfigured()) {
      return NextResponse.json(
        { error: "YouTube is not connected — use Connect YouTube in the Uploading Center first." },
        { status: 400 }
      );
    }
    const { channel } = await resolveChannel(input);
    let duplicate = false;
    const store = await updateOutlierStore((current) => {
      if (current.channels.some((existing) => existing.id === channel.id)) {
        duplicate = true;
        return current;
      }
      return { ...current, channels: [channel, ...current.channels] };
    });
    if (duplicate) {
      return NextResponse.json({ error: `${channel.title} is already on the watchlist.` }, { status: 409 });
    }
    return NextResponse.json({ channels: store.channels, added: channel });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH { id, group } — label a channel (e.g. "Competition") for the competition analysis. "" clears it. */
export async function PATCH(request: NextRequest) {
  let body: { id?: unknown; group?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id || typeof body.group !== "string") {
    return NextResponse.json({ error: "Provide { id, group } — group may be empty to clear the label." }, { status: 400 });
  }
  const group = normalizeGroupLabel(body.group);
  let found = false;
  const store = await updateOutlierStore((current) => ({
    ...current,
    channels: current.channels.map((channel) => {
      if (channel.id !== body.id) return channel;
      found = true;
      return { ...channel, group };
    })
  }));
  if (!found) return NextResponse.json({ error: "No watchlist channel with that id." }, { status: 404 });
  return NextResponse.json({ channels: store.channels });
}

/** DELETE ?id=UC… — remove a channel. Its flagged outliers (and your tags) are kept. */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing channel id." }, { status: 400 });
  const store = await updateOutlierStore((current) => ({
    ...current,
    channels: current.channels.filter((channel) => channel.id !== id)
  }));
  return NextResponse.json({ channels: store.channels });
}
