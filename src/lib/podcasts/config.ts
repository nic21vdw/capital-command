import {
  PODCAST_DESTINATIONS,
  type PodcastConnection,
} from "@/lib/podcasts/types";

export function podcastPublicBaseUrl() {
  return process.env.PODCAST_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || "";
}

export function podcastConnections(): PodcastConnection[] {
  const publicFeedReady = /^https:\/\//.test(podcastPublicBaseUrl());
  const artworkReady = /^https:\/\//.test(
    process.env.PODCAST_ARTWORK_URL?.trim() || "",
  );
  const ownerReady = Boolean(process.env.PODCAST_OWNER_EMAIL?.trim());
  return PODCAST_DESTINATIONS.map((destination) => ({
    ...destination,
    ready:
      destination.delivery === "rss"
        ? publicFeedReady &&
          (destination.id !== "apple" || (artworkReady && ownerReady))
        : false,
    note:
      destination.delivery === "rss"
        ? publicFeedReady
          ? destination.id === "apple" && (!artworkReady || !ownerReady)
            ? "Add PODCAST_ARTWORK_URL and PODCAST_OWNER_EMAIL for Apple validation."
            : "RSS feed ready — complete the one-time directory submission."
          : "Set PODCAST_PUBLIC_BASE_URL to a public HTTPS Command URL first."
        : "Export package ready; Substack publishing is manual for now.",
  }));
}
