/**
 * How much the centred video is punched in over its blurred fill.
 *
 * Center + blur used to drop the WHOLE widescreen frame into the middle of a
 * 9:16 canvas, which left the footage as a thin band with blur taking most of
 * the height. The composition now zooms the centred copy a little, so the
 * subject is bigger and the fill is only a border — the extreme left and right
 * edges of a widescreen source are given up for that, on purpose.
 *
 * This is a leaf (no imports) because every surface has to agree on the number:
 * the ready-to-post render, the Clip Editor's export and live preview, the
 * burned title's position, and the browser previews in `ClipFrame`.
 */

/** Zoom applied to the centred video when nothing else is specified. */
export const DEFAULT_CENTER_BLUR_ZOOM = 1.25;

/** Never below 1 — shrinking the video only grows the blur. */
export const MIN_CENTER_BLUR_ZOOM = 1;
/**
 * Past this a 16:9 source has lost roughly a third of its width, which is
 * cropping the shot rather than tightening it.
 */
export const MAX_CENTER_BLUR_ZOOM = 3;

export function clampCenterBlurZoom(zoom: number | undefined): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CENTER_BLUR_ZOOM;
  return Math.min(MAX_CENTER_BLUR_ZOOM, Math.max(MIN_CENTER_BLUR_ZOOM, zoom as number));
}

/**
 * The share of the output height the centred video covers: contain-fit the
 * source into the frame, then zoom it, capped at the full frame (past that the
 * overflow is cropped away and there is no fill left to see).
 */
export function centerBlurVideoHeightFrac(
  source: { width: number; height: number },
  target: { width: number; height: number },
  zoom: number = DEFAULT_CENTER_BLUR_ZOOM
): number {
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const tw = Math.max(1, target.width);
  const th = Math.max(1, target.height);
  const fit = Math.min(tw / sw, th / sh);
  return Math.min(1, (sh * fit * clampCenterBlurZoom(zoom)) / th);
}

/** Where the centred video starts, top-down, so a burned title clears it. */
export function centerBlurVideoTopFrac(
  source: { width: number; height: number },
  target: { width: number; height: number },
  zoom: number = DEFAULT_CENTER_BLUR_ZOOM
): number {
  return (1 - centerBlurVideoHeightFrac(source, target, zoom)) / 2;
}

/**
 * How far a contain-fitted video must be scaled before it covers the frame.
 * Zooming past this crops footage that a preview is meant to show, so browser
 * previews cap the zoom here — which is also what keeps an already-rendered
 * 9:16 file (the zoom is baked in) from being zoomed a second time.
 */
export function centerBlurCoverScale(sourceAspect: number, frameAspect: number): number {
  if (!Number.isFinite(sourceAspect) || !Number.isFinite(frameAspect)) return 1;
  if (sourceAspect <= 0 || frameAspect <= 0) return 1;
  return Math.max(sourceAspect / frameAspect, frameAspect / sourceAspect);
}
