import type { QueueItem } from "@/lib/publisher/types";

/**
 * Which queue items came from which clip card, worked out ONCE per queue.
 *
 * The Uploading Center asks this question constantly — every card asks for its
 * own posts, the run summary asks whether each clip is scheduled, and the
 * auto-assign plan asks again — and it used to answer each one by scanning the
 * whole publish queue and, inside that, every file the clip was ever postable
 * as. With a real queue (hundreds of items) and a run of clips that is tens of
 * thousands of path comparisons PER RENDER, and the page re-renders on every
 * keystroke in a caption box.
 *
 * A queue item names exactly one file, so the answer can be indexed from the
 * item's side: one pass over the queue, one pass over the clips, then every
 * lookup is a map read.
 */

/** The part of a clip card this index needs: its key and the files it owns. */
export type ClipFileRef = {
  /** Stable card key (jobId + output file). */
  key: string;
  jobId: string;
  /** Every file this clip has ever been postable as. */
  allFiles: string[];
};

/**
 * The queue stores repo-relative paths, sometimes with Windows separators, and
 * an item may name either the posted render (`clipPath`) or the file it was
 * derived from (`sourceClipPath`). Both are matched, and both forms a card
 * accepts: `<jobId>/<file>` at the end of the path, or a bare `<file>` when the
 * item already says which job it belongs to.
 */
function pathKeys(item: QueueItem): string[] {
  const keys: string[] = [];
  for (const candidate of [item.clipPath, item.sourceClipPath]) {
    if (!candidate) continue;
    const segments = candidate.replace(/\\/g, "/").split("/");
    if (segments.length < 2) continue;
    const file = segments[segments.length - 1];
    if (!file) continue;
    keys.push(`${segments[segments.length - 2]}/${file}`);
    if (item.jobId) keys.push(`${item.jobId}/${file}`);
  }
  return keys;
}

/**
 * Clip key → the queue items booked from that clip, in queue order. Clips with
 * nothing on the queue are absent rather than mapped to an empty array, so a
 * caller reads `get(key) ?? []`.
 */
export function indexQueueByClip(items: QueueItem[], clips: ClipFileRef[]): Map<string, QueueItem[]> {
  const byPath = new Map<string, QueueItem[]>();
  const position = new Map<string, number>();
  items.forEach((item, index) => {
    if (!position.has(item.id)) position.set(item.id, index);
    for (const key of pathKeys(item)) {
      let bucket = byPath.get(key);
      if (!bucket) {
        bucket = [];
        byPath.set(key, bucket);
      }
      if (bucket[bucket.length - 1] !== item) bucket.push(item);
    }
  });

  const byClip = new Map<string, QueueItem[]>();
  for (const clip of clips) {
    const seen = new Set<string>();
    const matches: QueueItem[] = [];
    for (const file of clip.allFiles) {
      for (const item of byPath.get(`${clip.jobId}/${file}`) ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        matches.push(item);
      }
    }
    if (matches.length === 0) continue;
    matches.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    byClip.set(clip.key, matches);
  }
  return byClip;
}
