import type { KeptRange } from "@/lib/longform/plan";
import { SCENE_DIFF, cutDifference, type VisualSample } from "@/lib/longform/visual-scan";

// ----- Zoom cuts -----
// Every dead-space and filler cut is a jump cut: the same shot, a few frames
// later, and the picture visibly hops. The classical fix is the zoom cut
// (punch-in): alternate the framing between a wide and a tighter crop at the
// cut, so the hop reads as a deliberate change of shot. Only two framings,
// only straight cuts, no animated moves: nothing an editor would call an
// effect.
//
// Rules:
// - A cut inside continuous footage (a short gap, the same picture either
//   side) toggles the framing, but only once the current framing has been held
//   long enough; flipping every half second is its own distraction.
// - A cut to different material (a long gap, or the picture changes) is a
//   straight cut back to wide: that is a new shot already.
// Pure: the render turns the plan into one zoompan expression.

export const ZOOM_CUT_LEVEL = 1.12;
/** Hold a framing at least this long before the next cut may flip it. */
const MIN_HOLD_SEC = 3.5;
/** A cut skipping more source than this lands on new material, not the same moment. */
const SAME_MOMENT_GAP_SEC = 8;

export type ZoomInterval = { start: number; end: number };

/**
 * Output intervals (seconds into the body) that play punched in, for body
 * ranges played back to back in the given order.
 */
export function planZoomCuts(bodyRanges: KeptRange[], samples: VisualSample[] = []): ZoomInterval[] {
  const zoomed: ZoomInterval[] = [];
  let outCursor = 0;
  let level = 0;
  let heldSince = 0;
  bodyRanges.forEach((range, index) => {
    const length = range.end - range.start;
    if (index > 0) {
      const previous = bodyRanges[index - 1];
      const gap = range.start - previous.end;
      const difference = samples.length ? cutDifference(samples, previous.end, range.start) : null;
      const newMaterial = gap < 0 || gap > SAME_MOMENT_GAP_SEC || (difference !== null && difference > SCENE_DIFF);
      if (newMaterial) {
        if (level !== 0) heldSince = outCursor;
        level = 0;
      } else if (outCursor - heldSince >= MIN_HOLD_SEC) {
        level = level === 0 ? 1 : 0;
        heldSince = outCursor;
      }
    }
    if (level === 1 && length > 0) {
      const last = zoomed[zoomed.length - 1];
      const start = round3(outCursor);
      const end = round3(outCursor + length);
      if (last && Math.abs(last.end - start) < 0.002) last.end = end;
      else zoomed.push({ start, end });
    }
    outCursor += length;
  });
  return zoomed;
}

/**
 * The zoompan filter for a plan, applied to a frame already at output size.
 * The frame is first scaled up to the punch-in size so the tight framing is a
 * 1:1 crop rather than an upscale; the wide framing is that frame scaled back
 * down. Focus is where the punch-in centres (the hook's focus: the face).
 */
export function zoomCutFilter(input: {
  zoomed: ZoomInterval[];
  width: number;
  height: number;
  fps: number;
  focusX: number;
  focusY: number;
}): string {
  const { zoomed, width, height, fps } = input;
  const bigW = even(width * ZOOM_CUT_LEVEL);
  const bigH = even(height * ZOOM_CUT_LEVEL);
  const inZoom = zoomed.length
    ? zoomed.map((interval) => `between(it,${interval.start.toFixed(3)},${(interval.end - 0.0005).toFixed(3)})`).join("+")
    : "0";
  const fx = clamp01(input.focusX).toFixed(3);
  const fy = clamp01(input.focusY).toFixed(3);
  return [
    `scale=${bigW}:${bigH}:flags=lanczos`,
    `zoompan=z='if(gt(${inZoom},0),${ZOOM_CUT_LEVEL},1)'` +
      `:x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}'` +
      `:d=1:s=${width}x${height}:fps=${fps}`
  ].join(",");
}

function even(value: number) {
  return Math.round(value / 2) * 2;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
