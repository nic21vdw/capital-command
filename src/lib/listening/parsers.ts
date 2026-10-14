import { excerptOf, matchingTerms, plainText, str, type ListeningHit } from "@/lib/listening/model";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function parseYoutubeSearch(json: unknown, terms: string[]): ListeningHit[] {
  const items = record(json)?.items;
  if (!Array.isArray(items)) throw new Error("YouTube answered without an items list.");
  const out: ListeningHit[] = [];
  for (const raw of items) {
    const item = record(raw);
    const videoId = str(record(item?.id)?.videoId);
    const snippet = record(item?.snippet);
    if (!videoId || !snippet) continue;
    const title = plainText(str(snippet.title)) || "(untitled)";
    const description = str(snippet.description);
    const matched = matchingTerms(`${title} ${plainText(description)}`, terms);
    if (matched.length === 0) continue;
    out.push({
      source: "youtube",
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: str(snippet.channelTitle),
      createdAt: str(snippet.publishedAt) || new Date(0).toISOString(),
      excerpt: excerptOf(description),
      matchedTerms: matched
    });
  }
  return out;
}

export function parseYoutubeComments(json: unknown, terms: string[], video: { id: string; title: string }): ListeningHit[] {
  const items = record(json)?.items;
  if (!Array.isArray(items)) throw new Error("YouTube answered without an items list.");
  const out: ListeningHit[] = [];
  for (const raw of items) {
    const item = record(raw);
    const comment = record(record(item?.snippet)?.topLevelComment);
    const snippet = record(comment?.snippet);
    const commentId = str(comment?.id) || str(item?.id);
    if (!snippet || !commentId) continue;
    const text = plainText(str(snippet.textDisplay) || str(snippet.textOriginal));
    const matched = matchingTerms(text, terms);
    if (matched.length === 0) continue;
    out.push({
      source: "youtube",
      title: `Comment on: ${video.title}`,
      url: `https://www.youtube.com/watch?v=${video.id}&lc=${commentId}`,
      author: str(snippet.authorDisplayName),
      createdAt: str(snippet.publishedAt) || new Date(0).toISOString(),
      excerpt: excerptOf(text),
      matchedTerms: matched
    });
  }
  return out;
}

const BLUESKY_POST_URI = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/]+)$/;
const BLUESKY_LOGGED_OUT_OPT_OUT = "!no-unauthenticated";

export function parseBlueskyResponse(json: unknown, terms: string[]): ListeningHit[] {
  const posts = record(json)?.posts;
  if (!Array.isArray(posts)) throw new Error("Bluesky answered without a posts list.");
  const out: ListeningHit[] = [];
  for (const raw of posts) {
    const post = record(raw);
    const author = record(post?.author);
    const body = record(post?.record);
    const rkey = BLUESKY_POST_URI.exec(str(post?.uri))?.[1];
    const handle = str(author?.handle);
    if (!rkey || !handle || !body) continue;
    const labels = Array.isArray(author?.labels) ? (author?.labels as unknown[]) : [];
    if (labels.some((label) => record(label)?.val === BLUESKY_LOGGED_OUT_OPT_OUT)) continue;
    const text = plainText(str(body.text));
    const matched = matchingTerms(text, terms);
    if (matched.length === 0) continue;
    out.push({
      source: "bluesky",
      title: text.length > 90 ? `${text.slice(0, 87)}...` : text,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      author: handle,
      createdAt: str(body.createdAt) || str(post?.indexedAt) || new Date(0).toISOString(),
      excerpt: excerptOf(text),
      matchedTerms: matched
    });
  }
  return out;
}
