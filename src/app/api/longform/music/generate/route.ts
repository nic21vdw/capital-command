import { NextRequest, NextResponse } from "next/server";
import { getTrack } from "@/lib/longform/music";
import type { MusicTrack } from "@/lib/longform/types";
import { advanceSong, getSongJob, listSongJobs, startSong } from "@/lib/music/jobs";
import { sunoConfigured, sunoModel } from "@/lib/music/suno";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Importing the finished takes downloads two MP3s.
export const maxDuration = 300;

async function tracksFor(trackIds: string[]): Promise<MusicTrack[]> {
  const tracks = await Promise.all(trackIds.map((id) => getTrack(id)));
  return tracks.filter((track): track is MusicTrack => Boolean(track));
}

/**
 * Polls a generation job, or lists recent ones. Polling is what ADVANCES a
 * job: when Suno reports the song is done, this is the call that pulls the
 * audio into the music library, and it's idempotent behind the ledger.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId")?.trim();
  if (!taskId) {
    return NextResponse.json({ configured: sunoConfigured(), model: sunoModel(), jobs: await listSongJobs() });
  }
  const job = (await advanceSong(taskId)) ?? (await getSongJob(taskId));
  if (!job) return NextResponse.json({ error: "No such generation job." }, { status: 404 });
  return NextResponse.json({ job, tracks: await tracksFor(job.trackIds) });
}

/** Starts a song: writes the Suno brief from the idea, then submits it. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    idea?: string;
    instrumental?: boolean;
  } | null;
  const idea = body?.idea?.trim() ?? "";
  if (!idea) return NextResponse.json({ error: "Describe the song you want." }, { status: 400 });

  const { job, error } = await startSong({ idea, instrumental: body?.instrumental });
  if (!job) return NextResponse.json({ error }, { status: sunoConfigured() ? 502 : 400 });
  return NextResponse.json({ job }, { status: 201 });
}
