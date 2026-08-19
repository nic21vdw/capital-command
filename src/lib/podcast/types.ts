// ----- Podcast feed (Spotify) -----
// Spotify has no write API for creators, so the app reaches it the way every
// podcast host does: it publishes an RSS feed and Spotify pulls from it. These
// are the two records behind that feed — the show, which is configured once,
// and one episode per long-form video that went out.

export type PodcastShow = {
  title: string;
  description: string;
  author: string;
  /** Spotify verifies ownership by emailing this address out of the feed. */
  email: string;
  /** The show's home page — the YouTube channel is a fine answer. */
  link: string;
  language: string;
  /** An Apple/Spotify top-level category, e.g. "Technology". */
  category: string;
  explicit: boolean;
  /** Square cover art, 1400-3000px, on a public HTTPS URL. */
  artworkUrl: string;
  copyright: string;
  /**
   * The show's Spotify id, once the feed has been claimed there. It is not a
   * feed tag — it is how the app asks Spotify whether an episode it offered
   * has actually been pulled in yet.
   */
  spotifyShowId?: string;
};

export type PodcastEpisode = {
  id: string;
  title: string;
  description: string;
  /** Public HTTPS URL of the MP3 — what Spotify actually downloads. */
  audioUrl: string;
  /** Object key in the media host, so a deleted episode can be cleaned up. */
  audioKey: string;
  bytes: number;
  durationSec: number;
  publishedAt: string;
  /** Where this came from, and what makes re-publishing it a no-op. */
  runId?: string;
  projectId?: string;
  exportId?: string;
  /** The YouTube watch page for the same recording, when it is known. */
  link?: string;
};

export type PodcastState = {
  show: PodcastShow;
  episodes: PodcastEpisode[];
};
