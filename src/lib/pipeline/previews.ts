import type { ClipJob } from "@/lib/clipping/types";

export type RunPreviews = {
  poster?: string;
  clips: string[];
  slides: string[];
};

const MAX_CLIPS = 4;
const MAX_SLIDES = 3;
const MAX_HEADING = 72;

export function clipThumbnailUrl(jobId: string, fileName: string): string {
  return `/api/clips/${jobId}/thumbnail/${encodeURIComponent(fileName)}`;
}

export function projectPosterUrl(projectId: string): string {
  return `/api/longform/projects/${projectId}/poster`;
}

export function runPreviews(input: {
  projectId?: string;
  job?: Pick<ClipJob, "id" | "clips">;
  slides?: { heading?: string }[];
}): RunPreviews {
  const clips = (input.job?.clips ?? [])
    .filter((clip) => Boolean(clip.file))
    .slice(0, MAX_CLIPS)
    .map((clip) => clipThumbnailUrl(input.job!.id, clip.file!));
  const slides = (input.slides ?? [])
    .map((slide) => (slide.heading ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_HEADING))
    .filter(Boolean)
    .slice(0, MAX_SLIDES);
  return {
    poster: input.projectId ? projectPosterUrl(input.projectId) : clips[0],
    clips,
    slides
  };
}
