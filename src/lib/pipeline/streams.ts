import type { PipelineRunOverview, PipelineStage, StreamSummary } from "./types";

/**
 * What a stream is, and where each of its pieces lives.
 *
 * The app fans one recording out into seven screens, and until now every one of
 * those screens was a flat list of everything ever made. This module is the one
 * place that answers "which stream am I working on, and what is its piece called
 * on that screen" — the sidebar, the context banner and every Formats link read
 * the same answer, so they can never disagree about what you have open.
 *
 * It is a leaf: no store, no network, so it stays testable.
 */

/** Stages that stand for a deliverable, not bookkeeping. */
const COUNTED_STAGES = [
  "longform",
  "segments",
  "clips",
  "audio",
  "podcast",
  "images",
  "posts"
] as const;

function counts(stages: Record<string, PipelineStage>): { ready: number; total: number } {
  let ready = 0;
  let total = 0;
  for (const key of COUNTED_STAGES) {
    const stage = stages[key];
    if (!stage) continue;
    // A skip by design was never going to produce anything, so counting it as
    // an outstanding step would leave every stream reading "5 of 7" forever.
    if (stage.status === "skipped") continue;
    total += 1;
    if (stage.status === "ready") ready += 1;
  }
  return { ready, total };
}

export function summarizeStream(overview: PipelineRunOverview): StreamSummary {
  const { run, stages } = overview;
  const { ready, total } = counts(stages as unknown as Record<string, PipelineStage>);
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    settled: overview.settled,
    needsAttention:
      run.status === "error" || overview.retryable.length > 0 || (run.queueFailures?.length ?? 0) > 0,
    ready,
    total,
    longformProjectId: run.longformProjectId,
    clipJobId: run.clipJobId,
    carouselId: run.carouselId,
    posts: run.posts?.length ?? 0,
    createdAt: run.createdAt
  };
}

/**
 * Which screens can show one stream on its own, and the id each one wants.
 *
 * Every entry here is a param the target page ALREADY reads. Adding a screen
 * means teaching that screen the param first — a link carrying an id nobody
 * reads is worse than no link, because the sidebar then claims a filter that
 * silently isn't applied.
 */
const STREAM_LINKS: { href: string; param: string; pick: (stream: StreamSummary) => string | undefined }[] = [
  { href: "/", param: "run", pick: (stream) => stream.id },
  { href: "/longform", param: "open", pick: (stream) => stream.longformProjectId },
  { href: "/clips", param: "job", pick: (stream) => stream.clipJobId },
  { href: "/editor", param: "job", pick: (stream) => stream.clipJobId },
  { href: "/carousels", param: "longform", pick: (stream) => stream.longformProjectId },
  { href: "/podcast", param: "project", pick: (stream) => stream.longformProjectId },
  { href: "/uploading-center", param: "job", pick: (stream) => stream.clipJobId }
];

/** True when this screen can be narrowed to a single stream at all. */
export function screenTakesStream(href: string): boolean {
  return STREAM_LINKS.some((entry) => entry.href === href);
}

/**
 * The query this screen wants in order to show only this stream, or null when
 * the stream has no piece there yet — a link to `/carousels?longform=undefined`
 * is a filter that matches nothing, which reads as "this stream made no
 * carousel" when the truth is "not written yet".
 */
export function streamLinkFor(
  href: string,
  stream: StreamSummary | null
): { param: string; value: string } | null {
  if (!stream) return null;
  const entry = STREAM_LINKS.find((candidate) => candidate.href === href);
  if (!entry) return null;
  const value = entry.pick(stream);
  return value ? { param: entry.param, value } : null;
}

/** The href for `screen` with `stream` carried into it, or the plain screen. */
export function streamHref(href: string, stream: StreamSummary | null): string {
  const link = streamLinkFor(href, stream);
  return link ? `${href}?${link.param}=${encodeURIComponent(link.value)}` : href;
}

/** How far along a stream reads in one short phrase. */
export function streamProgressLabel(stream: StreamSummary): string {
  if (stream.status === "ingesting") return "Importing…";
  if (stream.status === "error") return "Needs attention";
  if (stream.needsAttention) return "Needs attention";
  if (stream.settled) return "Ready to schedule";
  return `${stream.ready} of ${stream.total} formats ready`;
}
