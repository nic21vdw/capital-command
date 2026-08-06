import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";

/**
 * Locates the speaker in a clip so the vertical render can be framed on them
 * instead of shrinking the whole widescreen frame into a blurred letterbox.
 *
 * Detection is deliberately dependency-free and runs on tiny frames: ffmpeg
 * decodes the section once into a 192x108 raw RGB strip, and the analysis below
 * works on a grid of cells over it. Anisotropic downscaling is safe because
 * every coordinate this module produces is normalized to the source frame, and
 * normalized coordinates survive a non-uniform scale.
 *
 * What makes a person stand out from a screenshare is not skin tone alone —
 * warm syntax highlighting, a beige sidebar and a photo on a web page all pass
 * a skin-tone test. It is skin tone that MOVES CONTINUOUSLY. Text changes in
 * bursts and a photo never changes at all, so the product of "how skin-like"
 * and "how constantly moving", accumulated across the whole clip, leaves the
 * camera as the brightest thing in the frame. That product is what is searched.
 */

export const SAMPLE_FPS = 4;
export const FRAME_W = 192;
export const FRAME_H = 108;
const CELL_W = 4;
const CELL_H = 3;

export type SubjectSample = {
  /** Seconds into the analyzed section. */
  t: number;
  /** Subject box, normalized to the source frame. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  confidence: number;
};

export type SubjectTrack = {
  samples: SubjectSample[];
  /** How strongly the speaker stands out from the rest of the frame, 0-1. */
  confidence: number;
  /** Subject area as a fraction of the source frame. */
  area: number;
  /** How far the subject wanders across the section, 0-1 of frame width. */
  drift: number;
  frames: number;
};

export type RawFrame = { data: Uint8Array; width: number; height: number };

/** A located speaker region, in cell coordinates. */
export type SubjectRegion = {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  cx: number;
  cy: number;
  strength: number;
};

/**
 * Skin likelihood for one pixel, 0-1. Combines the classic RGB rule (bright,
 * red-dominant, with a spread between channels) with a YCbCr chroma window,
 * which together hold across skin tones and stream lighting while rejecting
 * the greys and blues that make up most of an editor or terminal screenshare.
 */
export function skinScore(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 45 || max > 250) return 0;
  if (max - min < 12) return 0;
  if (r <= g || r <= b) return 0;
  if (r - g < 10) return 0;

  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (cr < 133 || cr > 180 || cb < 74 || cb > 130) return 0;

  // Confidence tapers towards the edges of the chroma window, so a marginal
  // beige UI panel contributes far less than a lit face.
  const crFit = 1 - Math.abs(cr - 152) / 34;
  const cbFit = 1 - Math.abs(cb - 102) / 36;
  return Math.max(0, Math.min(1, Math.min(crFit, cbFit)));
}

function lumaAt(data: Uint8Array, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

export type CellGrid = { cols: number; rows: number; values: Float32Array };

function gridFor(frame: RawFrame): { cols: number; rows: number } {
  return { cols: Math.floor(frame.width / CELL_W), rows: Math.floor(frame.height / CELL_H) };
}

/** Mean skin likelihood per cell of one frame. */
export function skinGrid(frame: RawFrame): CellGrid {
  const { cols, rows } = gridFor(frame);
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      for (let y = row * CELL_H; y < (row + 1) * CELL_H; y += 1) {
        for (let x = col * CELL_W; x < (col + 1) * CELL_W; x += 1) {
          const i = (y * frame.width + x) * 3;
          sum += skinScore(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
        }
      }
      values[row * cols + col] = sum / (CELL_W * CELL_H);
    }
  }
  return { cols, rows, values };
}

/** Mean absolute luma change per cell between two frames. */
export function motionGrid(frame: RawFrame, previous: RawFrame): CellGrid {
  const { cols, rows } = gridFor(frame);
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      for (let y = row * CELL_H; y < (row + 1) * CELL_H; y += 1) {
        for (let x = col * CELL_W; x < (col + 1) * CELL_W; x += 1) {
          const i = (y * frame.width + x) * 3;
          sum += Math.abs(lumaAt(frame.data, i) - lumaAt(previous.data, i));
        }
      }
      values[row * cols + col] = sum / (CELL_W * CELL_H);
    }
  }
  return { cols, rows, values };
}

function percentile(values: Float32Array, fraction: number): number {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
}

/** A 3x3 mean, so a speckled face reads as one region rather than a scatter. */
export function smoothGrid(grid: CellGrid): CellGrid {
  const { cols, rows, values } = grid;
  const out = new Float32Array(values.length);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const y = row + dy;
          const x = col + dx;
          if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
          sum += values[y * cols + x];
          count += 1;
        }
      }
      out[row * cols + col] = count ? sum / count : 0;
    }
  }
  return { cols, rows, values: out };
}

/**
 * The "someone is here" map for a whole clip: mean skin likelihood times how
 * constantly the cell moved, normalized against the busiest cells of the frame
 * so it means the same thing on a still webcam and a wildly animated screen.
 */
export function speakerMap(frames: RawFrame[]): CellGrid {
  const first = skinGrid(frames[0]);
  const skin = new Float32Array(first.values.length);
  const motion = new Float32Array(first.values.length);
  for (let i = 0; i < frames.length; i += 1) {
    const cells = i === 0 ? first : skinGrid(frames[i]);
    for (let c = 0; c < skin.length; c += 1) skin[c] += cells.values[c];
    if (i === 0) continue;
    const moved = motionGrid(frames[i], frames[i - 1]);
    for (let c = 0; c < motion.length; c += 1) motion[c] += moved.values[c];
  }
  const pairs = Math.max(1, frames.length - 1);
  for (let c = 0; c < skin.length; c += 1) {
    skin[c] /= frames.length;
    motion[c] /= pairs;
  }
  // Normalizing on a high percentile rather than the maximum keeps one flashing
  // cell (a cursor, a notification) from flattening the rest of the map. The
  // floor matters for a single still frame, where nothing has moved yet and
  // every cell would otherwise be scored against zero.
  const reference = Math.max(0.6, percentile(motion, 0.97));
  const still = frames.length < 2;
  const combined = new Float32Array(skin.length);
  for (let c = 0; c < combined.length; c += 1) {
    combined[c] = still ? skin[c] : skin[c] * Math.min(1, motion[c] / reference);
  }
  return smoothGrid({ cols: first.cols, rows: first.rows, values: combined });
}

type Component = {
  mass: number;
  cells: number;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  sx: number;
  sy: number;
};

/** A blob must be at least this share of the strongest cell to count. */
const RELATIVE_THRESHOLD = 0.42;
/** ...and at least this strong outright, or the map holds nothing but noise. */
const ABSOLUTE_THRESHOLD = 0.035;
/** A head is solid: below this share of its own bounding box it is a scatter. */
const MIN_COVERAGE = 0.4;
/** Nothing person-shaped is this much taller than it is wide, or this squat. */
const MAX_ASPECT = 3.5;
const MIN_CELLS = 3;

function componentBox(component: Component) {
  const cols = component.maxCol - component.minCol + 1;
  const rows = component.maxRow - component.minRow + 1;
  return { cols, rows, cells: cols * rows };
}

function isSubjectShaped(component: Component): boolean {
  const box = componentBox(component);
  if (component.cells < MIN_CELLS) return false;
  if (box.cols / box.rows > MAX_ASPECT || box.rows / box.cols > MAX_ASPECT) return false;
  return component.cells / box.cells >= MIN_COVERAGE;
}

function strongestComponent(grid: CellGrid, threshold: number): Component | null {
  const { cols, rows, values } = grid;
  const seen = new Uint8Array(values.length);
  const stack: number[] = [];
  let best: Component | null = null;
  for (let start = 0; start < values.length; start += 1) {
    if (seen[start] || values[start] < threshold) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const comp: Component = { mass: 0, cells: 0, minCol: cols, maxCol: -1, minRow: rows, maxRow: -1, sx: 0, sy: 0 };
    while (stack.length) {
      const index = stack.pop() as number;
      const col = index % cols;
      const row = (index - col) / cols;
      const value = values[index];
      comp.mass += value;
      comp.cells += 1;
      comp.sx += value * (col + 0.5);
      comp.sy += value * (row + 0.5);
      if (col < comp.minCol) comp.minCol = col;
      if (col > comp.maxCol) comp.maxCol = col;
      if (row < comp.minRow) comp.minRow = row;
      if (row > comp.maxRow) comp.maxRow = row;
      const neighbours = [
        col > 0 ? index - 1 : -1,
        col < cols - 1 ? index + 1 : -1,
        row > 0 ? index - cols : -1,
        row < rows - 1 ? index + cols : -1
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || values[next] < threshold) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (!isSubjectShaped(comp)) continue;
    if (!best || comp.mass > best.mass) best = comp;
  }
  return best;
}

/**
 * Finds the speaker in a clip's {@link speakerMap}, or null when nothing in it
 * stands out enough to be a person.
 */
export function locateSpeakerRegion(map: CellGrid): SubjectRegion | null {
  let peak = 0;
  for (const value of map.values) if (value > peak) peak = value;
  if (peak < ABSOLUTE_THRESHOLD) return null;
  const component = strongestComponent(map, Math.max(ABSOLUTE_THRESHOLD, peak * RELATIVE_THRESHOLD));
  if (!component) return null;
  // A blob covering the whole frame is a warm-lit room, not a speaker in it.
  const box = componentBox(component);
  if (box.cols / map.cols > 0.9 && box.rows / map.rows > 0.9) return null;
  return {
    minCol: component.minCol,
    maxCol: component.maxCol,
    minRow: component.minRow,
    maxRow: component.maxRow,
    cx: component.sx / component.mass / map.cols,
    cy: component.sy / component.mass / map.rows,
    strength: component.mass / component.cells
  };
}

/** How strong a speaker region has to read to count as certainly a person. */
const FULL_CONFIDENCE_STRENGTH = 0.12;

/**
 * Follows the speaker frame by frame INSIDE the region the clip-wide map found,
 * so a photo of a face elsewhere on the screen can never pull the crop across
 * the frame. Frames where the speaker cannot be picked out hold the last
 * position rather than snapping back to the middle.
 */
export function trackSubject(frames: RawFrame[], fps = SAMPLE_FPS): SubjectTrack {
  if (frames.length === 0) return { samples: [], confidence: 0, area: 0, drift: 0, frames: 0 };
  const map = speakerMap(frames);
  const region = locateSpeakerRegion(map);
  if (!region) return { samples: [], confidence: 0, area: 0, drift: 0, frames: frames.length };

  const { cols, rows } = map;
  const width = (region.maxCol - region.minCol + 1) / cols;
  const height = (region.maxRow - region.minRow + 1) / rows;
  // Search a little outside the region so a speaker who leans out of it is
  // followed rather than clipped, but not so far that the search wanders.
  const padCols = Math.max(1, Math.round((region.maxCol - region.minCol + 1) * 0.5));
  const padRows = Math.max(1, Math.round((region.maxRow - region.minRow + 1) * 0.5));
  const minCol = Math.max(0, region.minCol - padCols);
  const maxCol = Math.min(cols - 1, region.maxCol + padCols);
  const minRow = Math.max(0, region.minRow - padRows);
  const maxRow = Math.min(rows - 1, region.maxRow + padRows);

  const samples: SubjectSample[] = [];
  const alpha = 0.35;
  let ax = region.cx;
  let ay = region.cy;
  for (let i = 0; i < frames.length; i += 1) {
    const skin = smoothGrid(skinGrid(frames[i]));
    let mass = 0;
    let sx = 0;
    let sy = 0;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const value = skin.values[row * cols + col];
        if (value < 0.2) continue;
        mass += value;
        sx += value * (col + 0.5);
        sy += value * (row + 0.5);
      }
    }
    if (mass > 0) {
      ax += (sx / mass / cols - ax) * alpha;
      ay += (sy / mass / rows - ay) * alpha;
    }
    samples.push({ t: i / fps, cx: ax, cy: ay, w: width, h: height, confidence: region.strength });
  }

  const xs = samples.map((sample) => sample.cx);
  return {
    samples,
    confidence: Math.min(1, region.strength / FULL_CONFIDENCE_STRENGTH),
    area: width * height,
    drift: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    frames: frames.length
  };
}

function splitFrames(buffer: Buffer, width: number, height: number): RawFrame[] {
  const size = width * height * 3;
  const frames: RawFrame[] = [];
  for (let offset = 0; offset + size <= buffer.length; offset += size) {
    frames.push({ data: new Uint8Array(buffer.subarray(offset, offset + size)), width, height });
  }
  return frames;
}

/**
 * Decodes a section into analysis frames and tracks the speaker across it.
 * Returns null when the file yields no frames — callers treat that the same as
 * "no subject found" and fall back to the neutral composition.
 */
export async function detectSubjectTrack(
  inputPath: string,
  { fps = SAMPLE_FPS, maxSeconds = 180 }: { fps?: number; maxSeconds?: number } = {}
): Promise<SubjectTrack | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "cc-subject-"));
  const rawPath = path.join(dir, "frames.raw");
  try {
    await runFfmpeg([
      "-y",
      "-t",
      String(maxSeconds),
      "-i",
      inputPath,
      "-an",
      "-vf",
      `fps=${fps},scale=${FRAME_W}:${FRAME_H}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      rawPath
    ]);
    const frames = splitFrames(await readFile(rawPath), FRAME_W, FRAME_H);
    if (!frames.length) return null;
    return trackSubject(frames, fps);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
