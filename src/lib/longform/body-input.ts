import type { KeptRange } from "@/lib/longform/plan";

// Keep a full minute before the first selection. Input seeking can trim its
// first audio frame; that frame must remain in discarded preroll rather than
// becoming the first kept packet of the edit.
const BODY_SEEK_PREROLL_SEC = 60;

type BodyInputWindow = { inputArgs: string[]; selectRanges: KeptRange[] };

/**
 * Bounds the body decode to its kept source window. Both select and aselect
 * must use selectRanges: input -ss subtracts the same offset from their PTS.
 * Source ranges stay untouched for captions, overlays, zoom cuts and the mix.
 */
export function bodyInputWindow(ranges: readonly KeptRange[]): BodyInputWindow {
  if (ranges.length === 0) throw new Error("The body has no kept ranges.");
  const firstStart = ranges.reduce((first, range) => Math.min(first, range.start), Infinity);
  const lastEnd = ranges.reduce((last, range) => Math.max(last, range.end), 0);
  // Whole seconds preserve the existing millisecond selector precision and
  // avoid seeking directly onto a video/audio cut boundary.
  const seekSec = Math.max(0, Math.floor(firstStart) - BODY_SEEK_PREROLL_SEC);
  const inputArgs = [
    ...(seekSec > 0 ? ["-ss", seekSec.toFixed(3)] : []),
    "-t",
    (Number((lastEnd + 1).toFixed(3)) - seekSec).toFixed(3)
  ];
  const selectRanges = seekSec > 0
    ? ranges.map((range) => ({
        start: Number((Number(range.start.toFixed(3)) - seekSec).toFixed(3)),
        end: Number((Number(range.end.toFixed(3)) - seekSec).toFixed(3))
      }))
    : ranges.map((range) => ({ ...range }));
  return { inputArgs, selectRanges };
}
