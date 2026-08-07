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

/**
 * The next segment with no finished video, or null when there is nothing left
 * to render — or when a render is already running, since starting a second one
 * is refused by the export engine anyway.
 */
export function nextSegmentToRender(project: Pick<LongformProject, "topics" | "exports">): LongformTopic | null {
  const topics = project.topics ?? [];
  if (topics.length === 0) return null;
  if (exportInFlight(project.exports)) return null;
  return topics.find((topic) => !segmentRendered(project.exports, topic)) ?? null;
}

export function segmentsRemaining(project: Pick<LongformProject, "topics" | "exports">): number {
  return (project.topics ?? []).filter((topic) => !segmentRendered(project.exports, topic)).length;
}
