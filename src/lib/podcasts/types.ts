export const PODCAST_DESTINATIONS = [
  {
    id: "spotify",
    label: "Spotify",
    delivery: "rss",
    setupUrl: "https://creators.spotify.com/",
    description: "Delivered from the Command Center podcast RSS feed.",
  },
  {
    id: "apple",
    label: "Apple Podcasts",
    delivery: "rss",
    setupUrl: "https://podcastsconnect.apple.com/",
    description:
      "Submit the Command Center RSS feed once; new episodes then flow automatically.",
  },
  {
    id: "youtube",
    label: "YouTube Music",
    delivery: "rss",
    setupUrl: "https://studio.youtube.com/",
    description:
      "Connect the RSS feed to a YouTube podcast for audio-first distribution.",
  },
  {
    id: "substack",
    label: "Substack",
    delivery: "manual",
    setupUrl: "https://substack.com/",
    description:
      "Prepared as an audio post with show notes; direct publishing stays manual until an API is available.",
  },
] as const;

export type PodcastDestinationId = (typeof PODCAST_DESTINATIONS)[number]["id"];
export type PodcastEpisodeKind = "full" | "chapter";
export type PodcastEpisodeStatus = "draft" | "scheduled" | "published";

export type PodcastEpisode = {
  id: string;
  jobId: string;
  sourceName: string;
  title: string;
  description: string;
  kind: PodcastEpisodeKind;
  startSec: number;
  endSec: number;
  durationSec: number;
  fileName: string;
  sizeBytes: number;
  /** Permanent public object URL when R2/S3_PUBLIC_BASE_URL is configured. */
  audioUrl?: string;
  transcriptExcerpt: string;
  destinations: PodcastDestinationId[];
  status: PodcastEpisodeStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PodcastLibrary = {
  version: 1;
  episodes: PodcastEpisode[];
};

export type PodcastConnection = {
  id: PodcastDestinationId;
  label: string;
  delivery: "rss" | "manual";
  setupUrl: string;
  description: string;
  ready: boolean;
  note: string;
};

export type PodcastGenerationMode = "full" | "chapters" | "full-and-chapters";
