import type { LongformExportRecord, LongformProject, LongformTopic } from "@/lib/longform/types";

// Which topic segment renders next. A stream splits into three to five whole
// subjects and each is its own ten-minute upload, but the export engine renders
// one at a time — so "render them all" is a standing instruction the advance
// loop drains, and this is the pure part it asks each time round.

export function segmentRendered(exports: LongformExportRecord[], topic: LongformTopic): boolean {
  return exports.some((record) => record.topicId === topic.id && record.status === "done" && Boolean(record.file));
}

export function exportInFlight(exports: LongformExportRecord[]): boolean {
  return exports.some((record) => record.status === "processing");
}

/** Renders of this segment that ended badly — it may simply be unrenderable. */
export function segmentFailures(exports: LongformExportRecord[], topic: LongformTopic): number {
  return exports.filter(
    (record) => record.topicId === topic.id && (record.status === "error" || record.status === "canceled")
  ).length;
}

/** A segment that has failed this many times is not going to render. */
export const SEGMENT_ATTEMPTS = 2;

/**
 * The next segment with no finished video, or null when there is nothing left
 * to render — or when a render is already running, since starting a second one
 * is refused by the export engine anyway.
 */
export function nextSegmentToRender(project: Pick<LongformProject, "topics" | "exports">): LongformTopic | null {
  const topics = project.topics ?? [];
  if (topics.length === 0) return null;
  if (exportInFlight(project.exports)) return null;
  // A segment that keeps failing is skipped rather than retried forever. The
  // render fails ASYNCHRONOUSLY, so the start call always looks like a success
  // — without this the drain loop restarted the same doomed segment on every
  // poll, and the run's own export record was evicted from the capped list.
  return (
    topics.find(
      (topic) =>
        !segmentRendered(project.exports, topic) && segmentFailures(project.exports, topic) < SEGMENT_ATTEMPTS
    ) ?? null
  );
}

export function segmentsRemaining(project: Pick<LongformProject, "topics" | "exports">): number {
  return (project.topics ?? []).filter((topic) => !segmentRendered(project.exports, topic)).length;
}

/** Nothing left that could render — either all done, or the rest keep failing. */
export function segmentsRenderable(project: Pick<LongformProject, "topics" | "exports">): number {
  return (project.topics ?? []).filter(
    (topic) => !segmentRendered(project.exports, topic) && segmentFailures(project.exports, topic) < SEGMENT_ATTEMPTS
  ).length;
}
