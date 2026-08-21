export const FACECAM_SAMPLE_WIDTH = 160;
export const FACECAM_SAMPLE_HEIGHT = 90;

const MIN_SKIN_CELLS = 40;
const EDGE_MIN_CONTRAST = 26;
const MIN_DENSITY = 0.16;
const WINDOW_FRACTIONS = [0.2, 0.26, 0.34, 0.44];

export type FacecamRect = { x: number; y: number; width: number; height: number };

export function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    max - min > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b
  );
}

/** How much of a region reads as skin, 0..1 — a face tile with nobody in it scores near zero. */
export function skinFraction(
  rgb: Uint8Array,
  rect: FacecamRect,
  width = FACECAM_SAMPLE_WIDTH,
  height = FACECAM_SAMPLE_HEIGHT
): number {
  const x0 = Math.max(0, Math.floor(rect.x * width));
  const y0 = Math.max(0, Math.floor(rect.y * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height));
  const cells = (x1 - x0) * (y1 - y0);
  if (cells <= 0) return 0;

  let skin = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 3;
      if (isSkin(rgb[offset], rgb[offset + 1], rgb[offset + 2])) skin += 1;
    }
  }
  return skin / cells;
}

export function skinMask(rgb: Uint8Array, width = FACECAM_SAMPLE_WIDTH, height = FACECAM_SAMPLE_HEIGHT): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 3;
    mask[index] = isSkin(rgb[offset], rgb[offset + 1], rgb[offset + 2]) ? 1 : 0;
  }
  return mask;
}

/**
 * The square-ish region of the frame that most looks like a person: on a
 * stream layout that is the facecam, which sits in a corner over a
 * screen-share. Returns normalised 0..1 coordinates, or null when the frame
 * has no meaningful skin in it at all (a slide, a BRB card, a dark room).
 */
export function detectFacecam(
  rgb: Uint8Array,
  width = FACECAM_SAMPLE_WIDTH,
  height = FACECAM_SAMPLE_HEIGHT
): FacecamRect | null {
  const mask = skinMask(rgb, width, height);
  const total = mask.reduce((sum: number, cell: number) => sum + cell, 0);
  if (total < MIN_SKIN_CELLS) return null;

  const integral = integralImage(mask, width, height);
  let best: { rect: FacecamRect; density: number } | null = null;

  for (const fraction of WINDOW_FRACTIONS) {
    const boxW = Math.max(2, Math.round(width * fraction));
    const boxH = boxW;
    if (boxW > width || boxH > height) continue;
    const stepX = Math.max(1, Math.round(boxW / 4));
    const stepY = Math.max(1, Math.round(boxH / 4));

    for (let y = 0; y + boxH <= height; y += stepY) {
      for (let x = 0; x + boxW <= width; x += stepX) {
        const inside = regionSum(integral, width, x, y, boxW, boxH);
        if (inside < MIN_SKIN_CELLS) continue;
        const density = inside / (boxW * boxH);
        const share = inside / total;
        const score = density * 0.55 + share * 0.45;
        if (density < MIN_DENSITY) continue;
        if (!best || score > best.density) {
          best = {
            density: score,
            rect: { x: x / width, y: y / height, width: boxW / width, height: boxH / height }
          };
        }
      }
    }
  }

  if (!best) return null;
  return refineToPane(rgb, width, height, best.rect);
}

/**
 * A facecam sits in a pane over a screen-share, so it is bounded by hard
 * edges. The scoring window lands somewhere inside that pane rather than on
 * it, so each side is pushed outward to the strongest luma edge it can find —
 * or to the frame border, which is where a corner facecam's outer sides are.
 * Without this the crop keeps going into whatever is underneath: on a coding
 * stream, the top of a terminal.
 */
export function refineToPane(rgb: Uint8Array, width: number, height: number, rect: FacecamRect): FacecamRect {
  const luma = (x: number, y: number) => {
    const offset = (y * width + x) * 3;
    return 0.299 * rgb[offset] + 0.587 * rgb[offset + 1] + 0.114 * rgb[offset + 2];
  };

  let left = Math.round(rect.x * width);
  let right = Math.min(width, Math.round((rect.x + rect.width) * width));
  let top = Math.round(rect.y * height);
  let bottom = Math.min(height, Math.round((rect.y + rect.height) * height));

  const bandLuma = (fixed: number, vertical: boolean) => {
    let sum = 0;
    let count = 0;
    const from = vertical ? top : left;
    const to = vertical ? bottom : right;
    for (let index = from; index < to; index += 1) {
      sum += vertical ? luma(fixed, index) : luma(index, fixed);
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  };

  const findEdge = (bound: number, from: number, limit: number, step: number, vertical: boolean) => {
    let edge = bound;
    let strongest = EDGE_MIN_CONTRAST;
    for (let index = from; step > 0 ? index < limit : index > limit; index += step) {
      const drop = Math.abs(bandLuma(index, vertical) - bandLuma(index - step, vertical));
      if (drop > strongest) {
        strongest = drop;
        edge = index;
      }
    }
    return edge;
  };

  const reachX = Math.round((right - left) * 0.9);
  const reachY = Math.round((bottom - top) * 0.9);

  const insetX = Math.round((right - left) * 0.45);
  const insetY = Math.round((bottom - top) * 0.45);

  const newLeft = findEdge(left, left + insetX, Math.max(1, left - reachX), -1, true);
  const newRight = findEdge(right, right - insetX, Math.min(width - 1, right + reachX), 1, true);
  const newTop = findEdge(top, top + insetY, Math.max(1, top - reachY), -1, false);
  const newBottom = findEdge(bottom, bottom - insetY, Math.min(height - 1, bottom + reachY), 1, false);

  if (newRight - newLeft >= 4) {
    left = newLeft;
    right = newRight;
  }
  if (newBottom - newTop >= 4) {
    top = newTop;
    bottom = newBottom;
  }

  return {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height
  };
}

/**
 * The tile used as the thumbnail subject: the detected pane, capped so a very
 * wide or very tall pane still reads as a portrait rather than a letterbox.
 */
export function faceCrop(rect: FacecamRect, frameAspect: number, maxRatio = 1.5): FacecamRect {
  const pixelW = rect.width * frameAspect;
  const pixelH = rect.height;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  let width = rect.width;
  let height = rect.height;
  if (pixelW > pixelH * maxRatio) width = (pixelH * maxRatio) / frameAspect;
  if (pixelH > pixelW * maxRatio) height = pixelW * maxRatio;

  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function integralImage(mask: Uint8Array, width: number, height: number): Int32Array {
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  return integral;
}

function regionSum(integral: Int32Array, width: number, x: number, y: number, boxW: number, boxH: number) {
  const stride = width + 1;
  const x2 = x + boxW;
  const y2 = y + boxH;
  return (
    integral[y2 * stride + x2] -
    integral[y * stride + x2] -
    integral[y2 * stride + x] +
    integral[y * stride + x]
  );
}
