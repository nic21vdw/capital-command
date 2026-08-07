import { NextRequest, NextResponse } from "next/server";
import { artworkProblems, readImageSize } from "@/lib/podcast/artwork";
import { feedUrl, podcastConfigured, refreshFeed } from "@/lib/podcast/publish";
import { updateShow } from "@/lib/podcast/store";
import { publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Takes the cover image itself rather than a URL to one. Finding somewhere
 * public to put a JPEG was the one step in setting the show up that the app
 * could do and was making a person do instead.
 */
export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!podcastConfigured(config)) {
    return NextResponse.json(
      { error: "There is nowhere public to put the cover art yet — give the bucket its public address under Feed URL first." },
      { status: 409 }
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach an image file." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = readImageSize(bytes);
  const problems = artworkProblems(size);
  if (problems.length > 0) {
    return NextResponse.json({ error: problems.join(" ") }, { status: 400 });
  }

  const host = mediaHost(config)!;
  const key = `podcast/cover.${size!.format === "png" ? "png" : "jpg"}`;
  await host.putObjectBytes(key, bytes, size!.format === "png" ? "image/png" : "image/jpeg");
  // Cache-busted, because the key is stable and Spotify would otherwise keep
  // showing the image it fetched the first time.
  const artworkUrl = `${feedUrl(config)!.replace(/\/podcast\/feed\.xml$/, "")}/${key}?v=${Date.now()}`;

  const state = await updateShow({ artworkUrl });
  await refreshFeed(state);
  return NextResponse.json({ artworkUrl, width: size!.width, height: size!.height });
}
