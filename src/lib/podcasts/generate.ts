import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { fetchJobCaptions, getJob, workDir } from "@/lib/clipping/jobs";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { planPodcastRanges } from "@/lib/podcasts/planner";
import { podcastAudioDir, upsertPodcastEpisodes } from "@/lib/podcasts/store";
import type {
  PodcastEpisode,
  PodcastGenerationMode,
} from "@/lib/podcasts/types";
import { publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";

function stableEpisodeId(
  jobId: string,
  kind: string,
  start: number,
  end: number,
) {
  return `pod-${jobId}-${kind}-${Math.round(start)}-${Math.round(end)}`;
}

function safeFilePart(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "episode"
  );
}

async function sourceMediaPath(jobId: string) {
  const job = await getJob(jobId);
  if (!job) throw new Error("That livestream job no longer exists.");
  if (job.sourceId) {
    const meta = await readSourceMeta(job.sourceId);
    if (!meta)
      throw new Error(
        "The original uploaded livestream is no longer available.",
      );
    return sourceFilePath(meta);
  }
  const cachedAudio = path.join(workDir(job.id), "source-audio.mp3");
  await access(cachedAudio).catch(() => {
    throw new Error(
      "The cached livestream audio is missing. Re-run the livestream through Clip Generator first.",
    );
  });
  return cachedAudio;
}

export async function generatePodcastEpisodes(
  jobId: string,
  mode: PodcastGenerationMode,
) {
  let job = await getJob(jobId);
  if (!job) throw new Error("That livestream job could not be found.");
  if (job.status !== "done")
    throw new Error(
      "Wait for the livestream to finish processing before creating podcast audio.",
    );
  if (!job.sourceCaptions?.length) job = (await fetchJobCaptions(jobId)) ?? job;

  const ranges = planPodcastRanges(job, mode);
  if (ranges.length === 0)
    throw new Error(
      "No usable podcast ranges could be created from this livestream.",
    );
  const input = await sourceMediaPath(jobId);
  const audioDir = podcastAudioDir();
  await mkdir(audioDir, { recursive: true });
  const now = new Date().toISOString();
  const episodes: PodcastEpisode[] = [];
  const publishing = publisherConfig();
  const host = publishing.s3.publicBaseUrl ? mediaHost(publishing) : null;

  for (const range of ranges) {
    const id = stableEpisodeId(
      job.id,
      range.kind,
      range.startSec,
      range.endSec,
    );
    const fileName = `${safeFilePart(range.title)}-${id}.mp3`;
    const output = path.join(audioDir, fileName);
    await runFfmpeg([
      "-y",
      "-ss",
      range.startSec.toFixed(2),
      "-i",
      input,
      "-t",
      Math.max(0.1, range.endSec - range.startSec).toFixed(2),
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "160k",
      "-metadata",
      `title=${range.title}`,
      "-metadata",
      "artist=Nic Vandewetering",
      "-metadata",
      "album=Command Center Podcast",
      output,
    ]);
    const audioUrl = host
      ? await host
          .upload(output, `podcasts/audio/${fileName}`)
          .then((key) => host.publicUrl(key))
      : undefined;
    episodes.push({
      id,
      jobId: job.id,
      sourceName: job.fileName,
      title: range.title,
      description: range.description,
      kind: range.kind,
      startSec: range.startSec,
      endSec: range.endSec,
      durationSec: Math.max(1, range.endSec - range.startSec),
      fileName,
      audioUrl,
      transcriptExcerpt: range.transcriptExcerpt,
      destinations: ["spotify", "apple", "youtube", "substack"],
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  }

  await upsertPodcastEpisodes(episodes);
  return episodes;
}
