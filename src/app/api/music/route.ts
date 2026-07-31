import { NextRequest, NextResponse } from "next/server";
import { getTrack, listTracks } from "@/lib/longform/music";
import type { MusicTrack } from "@/lib/longform/types";
import { falConfigured } from "@/lib/music/fal";
import { advanceMusicJob, getMusicJob, listMusicJobs, startMusicJob } from "@/lib/music/jobs";
import { MUSIC_MODELS, type MusicModelId } from "@/lib/music/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Importing finished takes downloads audio files.
export const maxDuration = 300;

async function tracksFor(trackIds: string[]): Promise<MusicTrack[]> {
  const tracks = await Promise.all(trackIds.map((id) => getTrack(id)));
  return tracks.filter((track): track is MusicTrack => Boolean(track));
}

/**
 * Studio state, or one job's progress.
 *
 * Polling with a requestId is what ADVANCES a job: when the model reports
 * COMPLETED, this is the call that pulls the audio into the music library,
 * and it's idempotent behind the ledger.
 */
export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim();
  if (!requestId) {
    const [jobs, tracks] = await Promise.all([listMusicJobs(), listTracks()]);
    return NextResponse.json({ configured: falConfigured(), models: MUSIC_MODELS, jobs, tracks });
  }
  const job = (await advanceMusicJob(requestId)) ?? (await getMusicJob(requestId));
  if (!job) return NextResponse.json({ error: "No such generation job." }, { status: 404 });
  return NextResponse.json({ job, tracks: await tracksFor(job.trackIds) });
}

/** Starts a generation on the chosen model. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    modelId?: string;
    prompt?: string;
    lyrics?: string;
    instrumental?: boolean;
    durationSec?: number;
    samples?: number;
    title?: string;
  } | null;

  const prompt = body?.prompt?.trim() ?? "";
  if (!prompt) return NextResponse.json({ error: "Describe the music you want." }, { status: 400 });

  const { job, error } = await startMusicJob({
    modelId: (body?.modelId as MusicModelId) ?? "lyria3-pro",
    prompt,
    lyrics: body?.lyrics,
    instrumental: body?.instrumental ?? true,
    durationSec: body?.durationSec,
    samples: body?.samples,
    title: body?.title
  });
  if (!job) return NextResponse.json({ error }, { status: falConfigured() ? 502 : 400 });
  return NextResponse.json({ job }, { status: 201 });
}
