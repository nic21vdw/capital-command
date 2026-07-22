import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getPodcastEpisode, podcastAudioDir } from "@/lib/podcasts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function audioResponse(request: NextRequest, headOnly: boolean) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const episode = await getPodcastEpisode(id);
  if (!episode) return new Response("Episode not found", { status: 404 });
  const filePath = path.join(podcastAudioDir(), path.basename(episode.fileName));
  const info = await stat(filePath).catch(() => null);
  if (!info) return new Response("Audio file not found", { status: 404 });

  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  if (start < 0 || end < start || start >= info.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
  }
  const partial = Boolean(range);
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/mpeg",
    "Content-Length": String(end - start + 1),
    "Content-Disposition": `inline; filename="${path.basename(episode.fileName)}"`,
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {})
  };
  if (headOnly) return new Response(null, { status: partial ? 206 : 200, headers });
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(stream, { status: partial ? 206 : 200, headers });
}

export async function GET(request: NextRequest) {
  return audioResponse(request, false);
}

export async function HEAD(request: NextRequest) {
  return audioResponse(request, true);
}

