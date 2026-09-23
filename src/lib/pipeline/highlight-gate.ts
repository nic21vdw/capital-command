// Whether the Stream Pipeline builds a best-of edit before it renders the
// run's long-form video. Pure, so the decision is tested without a stream.
//
// The pipeline used to render the whole recording with its dead space cut,
// which on a three-hour stream is a two-hour upload nobody finishes. A stream
// that long is now cut down to its strongest passages first. That needs the
// whole stream's words, which the clip job writes, so the render waits for
// them while they are still coming, and falls back to the whole edit when
// they never will.

/** An edit this much longer than the target is worth cutting down. */
export const HIGHLIGHT_TRIGGER_RATIO = 1.25;

export type LongformExportGate = "export" | "build" | "wait";

export function longformExportGate(input: {
  /** Runtime of the edit as it stands, dead space already cut. */
  editedSec: number;
  /** The runtime a best-of edit aims for. */
  targetSec: number;
  /** A best-of edit already exists on the project. */
  hasHighlight: boolean;
  /** The run already tried to build one (successfully or not). */
  highlightTried: boolean;
  /** A transcript of the whole recording exists. */
  transcriptReady: boolean;
  /** The clip job that writes that transcript is still working. */
  transcriptPending: boolean;
}): LongformExportGate {
  if (input.hasHighlight || input.highlightTried) return "export";
  if (input.editedSec <= input.targetSec * HIGHLIGHT_TRIGGER_RATIO) return "export";
  if (input.transcriptReady) return "build";
  if (input.transcriptPending) return "wait";
  return "export";
}
