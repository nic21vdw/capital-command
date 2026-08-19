import { NextRequest, NextResponse } from "next/server";
import { updateShow } from "@/lib/podcast/store";
import { parseShowId, searchShows } from "@/lib/spotify/api";
import { disconnectSpotify } from "@/lib/spotify/auth";
import { spotifyStatus } from "@/lib/spotify/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload() {
  return NextResponse.json(await spotifyStatus());
}

export async function GET() {
  return payload();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    if (action === "search-shows") {
      const query = String(body.query ?? "").trim();
      if (!query) return NextResponse.json({ error: "Type something to search for." }, { status: 400 });
      return NextResponse.json({ results: await searchShows(query) });
    }

    if (action === "link-show") {
      const showId = parseShowId(String(body.show ?? ""));
      if (!showId) {
        return NextResponse.json(
          { error: "That is not a Spotify show — paste the show's link, or search for it above." },
          { status: 400 }
        );
      }
      await updateShow({ spotifyShowId: showId });
      return payload();
    }

    if (action === "unlink-show") {
      await updateShow({ spotifyShowId: "" });
      return payload();
    }

    if (action === "disconnect") {
      await disconnectSpotify();
      return payload();
    }

    if (action === "refresh") {
      return payload();
    }

    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
