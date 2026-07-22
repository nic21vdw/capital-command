import { NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/lib/clipping/jobs";
import {
  podcastConnections,
  podcastPublicBaseUrl,
} from "@/lib/podcasts/config";
import { generatePodcastEpisodes } from "@/lib/podcasts/generate";
import {
  listPodcastEpisodes,
  updatePodcastEpisode,
} from "@/lib/podcasts/store";
import type {
  PodcastDestinationId,
  PodcastEpisodeStatus,
  PodcastGenerationMode,
} from "@/lib/podcasts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = new Set<PodcastGenerationMode>([
  "full",
  "chapters",
  "full-and-chapters",
]);
const DESTINATIONS = new Set<PodcastDestinationId>([
  "spotify",
  "apple",
  "youtube",
  "substack",
]);
const STATUSES = new Set<PodcastEpisodeStatus>([
  "draft",
  "scheduled",
  "published",
]);

export async function GET(request: NextRequest) {
  const [jobs, episodes] = await Promise.all([
    listJobs(),
    listPodcastEpisodes(),
  ]);
  const base = podcastPublicBaseUrl() || request.nextUrl.origin;
  return NextResponse.json({
    jobs: jobs
      .filter((job) => job.status === "done")
      .map((job) => ({
        id: job.id,
        fileName: job.fileName,
        createdAt: job.createdAt,
        durationSec: job.durationSec ?? 0,
        hasTranscript: Boolean(job.sourceCaptions?.length),
        episodeCount: episodes.filter((episode) => episode.jobId === job.id)
          .length,
      })),
    episodes,
    connections: podcastConnections(),
    feedUrl: `${base}/api/podcasts/feed`,
    publicFeedReady: Boolean(podcastPublicBaseUrl()),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      jobId?: string;
      mode?: PodcastGenerationMode;
    };
    const jobId = body.jobId?.trim();
    const mode = body.mode ?? "full-and-chapters";
    if (!jobId)
      return NextResponse.json(
        { error: "Choose a livestream first." },
        { status: 400 },
      );
    if (!MODES.has(mode))
      return NextResponse.json(
        { error: "Unknown podcast generation mode." },
        { status: 400 },
      );
    const episodes = await generatePodcastEpisodes(jobId, mode);
    return NextResponse.json({ episodes }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    id?: string;
    title?: string;
    description?: string;
    destinations?: string[];
    scheduledAt?: string | null;
    status?: PodcastEpisodeStatus;
    publishNow?: boolean;
  };
  if (!body.id)
    return NextResponse.json(
      { error: "Episode id is required." },
      { status: 400 },
    );
  const destinations = body.destinations?.filter(
    (id): id is PodcastDestinationId =>
      DESTINATIONS.has(id as PodcastDestinationId),
  );
  const status = body.publishNow ? "published" : body.status;
  if (status && !STATUSES.has(status))
    return NextResponse.json(
      { error: "Unknown episode status." },
      { status: 400 },
    );
  const scheduledAt = body.scheduledAt === null ? undefined : body.scheduledAt;
  if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) {
    return NextResponse.json(
      { error: "Choose a valid schedule time." },
      { status: 400 },
    );
  }
  const episode = await updatePodcastEpisode(body.id, {
    ...(typeof body.title === "string" && body.title.trim()
      ? { title: body.title.trim() }
      : {}),
    ...(typeof body.description === "string"
      ? { description: body.description.trim() }
      : {}),
    ...(destinations ? { destinations } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(status ? { status } : {}),
    ...(body.publishNow
      ? { publishedAt: new Date().toISOString(), scheduledAt: undefined }
      : {}),
  });
  if (!episode)
    return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  return NextResponse.json({ episode });
}
