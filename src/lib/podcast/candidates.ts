import type { LongformProject } from "@/lib/longform/types";
import type { PodcastEpisode } from "@/lib/podcast/types";

/**
 * A finished long-form export offered to the Podcast page as an episode. The
 * page picks from these rather than asking for a project id and an export id,
 * which nothing in the app ever shows.
 */
export type EpisodeCandidate = {
  projectId: string;
  exportId: string;
  projectName: string;
  title: string;
  durationSec: number;
  createdAt: string;
  /** Whether the MP3 has been cut yet — the episode IS the MP3. */
  hasAudio: boolean;
  /** Already in the feed, so publishing it again would change nothing. */
  published: boolean;
};

/**
 * Every finished export, newest first, with the ones already in the feed
 * marked rather than hidden — an episode disappearing from the list reads as
 * "the app lost it" when it actually means "already done".
 */
export function episodeCandidates(projects: LongformProject[], episodes: PodcastEpisode[]): EpisodeCandidate[] {
  const published = new Set(episodes.map((episode) => episode.exportId).filter(Boolean) as string[]);
  return projects
    .flatMap((project) =>
      project.exports
        .filter((record) => record.status === "done" && Boolean(record.file))
        .map((record) => ({
          projectId: project.id,
          exportId: record.id,
          projectName: project.name,
          title: record.title ?? project.metadata?.titles[0] ?? project.name,
          durationSec: record.durationSec ?? 0,
          createdAt: record.createdAt,
          hasAudio: Boolean(record.audioFile),
          published: published.has(record.id)
        }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
