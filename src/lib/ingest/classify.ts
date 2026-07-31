import type { ChannelUpload, IngestDecision } from "@/lib/ingest/types";

/**
 * The decision layer of the daily channel scan. Pure on purpose — every rule
 * here is a judgement about your content, so each one is directly testable
 * without a YouTube round trip.
 *
 * Three independent guards stop the distribution centre from eating its own
 * tail, or redoing work it has already done:
 *
 *  1. **Exact provenance.** Anything this app published to YouTube is recorded
 *     in the publish queue as `platforms.youtube.postId`. An id match is proof,
 *     not a guess, and it is checked first.
 *  2. **Already in the pipeline.** A video that is already some pipeline run's
 *     source has been taken in, whether a scan did it or you pasted the link
 *     yourself. Without this, the first scan on an established channel
 *     re-downloads and re-clips every stream you handled by hand.
 *  3. **Shape.** A vertical video of three minutes or less is a Short. That
 *     catches Shorts posted by hand from a phone, which never went through the
 *     queue and so have no postId to match.
 *
 * Live streams short-circuit the shape test: a stream is never a Short, and its
 * VOD is exactly the thing worth clipping.
 */

/** Shorts are capped at three minutes, so that is the shape cutoff. */
export const SHORT_MAX_SECONDS = 180;

/**
 * Parses YouTube's ISO-8601 duration (`PT1H2M3S`, `P1DT2H`) to seconds.
 * Returns 0 for anything unparseable — callers treat 0 as "unknown", never as
 * "instant", so an unreadable duration can't masquerade as a Short.
 */
export function parseIso8601Duration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(iso.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** True when the frame is taller than it is wide. */
export function isVertical(aspect: ChannelUpload["aspect"]): boolean {
  if (!aspect || aspect.width <= 0 || aspect.height <= 0) return false;
  return aspect.height > aspect.width;
}

/**
 * Decide what to do with one upload.
 *
 * @param upload the video, as read from the channel
 * @param seen ids we already know about: everything the publisher posted, and
 *   everything a previous scan took in
 * @param options `liveOnly` narrows the scan to live stream VODs and leaves
 *   ordinary uploads alone — the default for the automated daily run, where a
 *   stream is the thing worth fanning out into every format unattended.
 */
export function decideUpload(
  upload: ChannelUpload,
  seen: {
    publishedPostIds: ReadonlySet<string>;
    ingestedVideoIds: ReadonlySet<string>;
    /** Videos that are already the source of a pipeline run (see guard 2). */
    pipelineVideoIds?: ReadonlySet<string>;
  },
  options: { liveOnly?: boolean } = {}
): IngestDecision {
  // Provenance first: this is the only check that is certain, so nothing below
  // ever gets the chance to second-guess it.
  if (seen.publishedPostIds.has(upload.videoId)) {
    return { action: "skip", reason: "published-by-distribution-centre" };
  }
  if (seen.ingestedVideoIds.has(upload.videoId)) {
    return { action: "skip", reason: "already-ingested" };
  }
  if (seen.pipelineVideoIds?.has(upload.videoId)) {
    return { action: "skip", reason: "already-in-the-pipeline" };
  }

  // Private and unlisted uploads are drafts, not published content. Ingesting a
  // draft would start clipping something you have not decided to release.
  if (upload.privacyStatus !== "public") {
    return { action: "skip", reason: "not-public" };
  }

  // A live stream is never a Short, whatever its duration says, so it skips the
  // shape test entirely — a short technical-difficulties stream still counts.
  if (upload.wasLiveStream) {
    return { action: "ingest", reason: "live-stream" };
  }

  // Everything below here is an ordinary upload. In live-only mode that is not
  // what the run is for, so it stops here rather than falling through to the
  // Short heuristics — the shape of a non-stream is irrelevant when nothing but
  // streams is being taken in.
  if (options.liveOnly) {
    return { action: "skip", reason: "not-a-live-stream" };
  }

  const short = upload.durationSec > 0 && upload.durationSec <= SHORT_MAX_SECONDS;
  if (short && isVertical(upload.aspect)) {
    return { action: "skip", reason: "short-vertical" };
  }
  if (short && upload.aspect === null) {
    // Short enough to be a Short, but we could not read the frame shape. Held
    // back rather than ingested: re-clipping a Short is the failure mode this
    // whole scan exists to prevent. Flagged so it appears in the report instead
    // of vanishing — you can still take it in by hand.
    return { action: "skip", reason: "probable-short-unknown-aspect", needsReview: true };
  }

  return { action: "ingest", reason: "long-form-upload" };
}

/** Human-readable reason, for the CLI report and the ledger. */
export function explainDecision(decision: IngestDecision): string {
  switch (decision.reason) {
    case "live-stream":
      return "live stream VOD";
    case "long-form-upload":
      return "long-form upload";
    case "published-by-distribution-centre":
      return "published by this app (postId match)";
    case "already-ingested":
      return "already ingested by an earlier scan";
    case "short-vertical":
      return `Short (vertical, <= ${SHORT_MAX_SECONDS}s)`;
    case "probable-short-unknown-aspect":
      return `probably a Short (<= ${SHORT_MAX_SECONDS}s, frame shape unknown) — review by hand`;
    case "not-public":
      return "not public";
    case "not-a-live-stream":
      return "not a live stream (live-only scan)";
    case "already-in-the-pipeline":
      return "already a pipeline run's source";
  }
}
