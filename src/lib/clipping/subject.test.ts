import { describe, expect, it } from "vitest";
import {
  FRAME_H,
  FRAME_W,
  locateSpeakerRegion,
  skinGrid,
  skinScore,
  speakerMap,
  trackSubject,
  type RawFrame
} from "./subject";

type Box = { x: number; y: number; w: number; h: number };

const SKIN: [number, number, number] = [205, 152, 128];

/** A dark frame with coloured rectangles painted into it. */
function frameWith(boxes: Array<Box & { tone?: [number, number, number] }>): RawFrame {
  const data = new Uint8Array(FRAME_W * FRAME_H * 3);
  for (let y = 0; y < FRAME_H; y += 1) {
    for (let x = 0; x < FRAME_W; x += 1) {
      const i = (y * FRAME_W + x) * 3;
      let tone: [number, number, number] = [24, 26, 32];
      for (const box of boxes) {
        const inside =
          x >= box.x * FRAME_W &&
          x < (box.x + box.w) * FRAME_W &&
          y >= box.y * FRAME_H &&
          y < (box.y + box.h) * FRAME_H;
        if (inside) tone = box.tone ?? SKIN;
      }
      data[i] = tone[0];
      data[i + 1] = tone[1];
      data[i + 2] = tone[2];
    }
  }
  return { data, width: FRAME_W, height: FRAME_H };
}

describe("skinScore", () => {
  it("scores lit skin tones and rejects screen colors", () => {
    expect(skinScore(205, 152, 128)).toBeGreaterThan(0.4);
    expect(skinScore(150, 106, 88)).toBeGreaterThan(0.2);
    // The greys and blues an editor or terminal share is made of.
    expect(skinScore(30, 32, 38)).toBe(0);
    expect(skinScore(120, 120, 120)).toBe(0);
    expect(skinScore(60, 120, 220)).toBe(0);
    expect(skinScore(255, 255, 255)).toBe(0);
  });
});

describe("skinGrid", () => {
  it("lights up the cells the skin is actually in", () => {
    const grid = skinGrid(frameWith([{ x: 0.6, y: 0.1, w: 0.2, h: 0.4 }]));
    const at = (fx: number, fy: number) =>
      grid.values[Math.floor(fy * grid.rows) * grid.cols + Math.floor(fx * grid.cols)];
    expect(at(0.7, 0.3)).toBeGreaterThan(0.4);
    expect(at(0.2, 0.8)).toBe(0);
  });
});

describe("speakerMap", () => {
  it("picks the moving face over a still one, which is a photo on the screen", () => {
    // A static skin-toned rectangle (a thumbnail on a web page) on the left,
    // and a speaker on the right who moves between frames.
    const frames = [0, 0.03, 0.06, 0.03].map((shift) =>
      frameWith([
        { x: 0.08, y: 0.3, w: 0.16, h: 0.25 },
        { x: 0.66 + shift, y: 0.3, w: 0.16, h: 0.3 }
      ])
    );
    const region = locateSpeakerRegion(speakerMap(frames));
    expect(region).not.toBeNull();
    expect(region!.cx).toBeGreaterThan(0.55);
  });

  it("finds nobody in a frame with no skin in it", () => {
    const blank: RawFrame = { data: new Uint8Array(FRAME_W * FRAME_H * 3).fill(40), width: FRAME_W, height: FRAME_H };
    expect(locateSpeakerRegion(speakerMap([blank, blank]))).toBeNull();
  });

  it("refuses to call a warm-toned whole frame a speaker", () => {
    const frames = [
      frameWith([{ x: 0, y: 0, w: 1, h: 1 }]),
      frameWith([{ x: 0, y: 0, w: 1, h: 1, tone: [200, 148, 124] }])
    ];
    expect(locateSpeakerRegion(speakerMap(frames))).toBeNull();
  });
});

describe("trackSubject", () => {
  it("follows the speaker across the clip and smooths the path", () => {
    // The tone shifts frame to frame as well as the position: a real face is
    // textured, so it changes all over as it talks, not only at its edges.
    const frames = [0, 0.02, 0.04, 0.06, 0.08, 0.1].map((shift, i) =>
      frameWith([{ x: 0.3 + shift, y: 0.2, w: 0.18, h: 0.45, tone: i % 2 ? [205, 152, 128] : [186, 138, 116] }])
    );
    const track = trackSubject(frames, 2);
    expect(track.samples).toHaveLength(frames.length);
    expect(track.confidence).toBeGreaterThan(0.5);
    expect(track.area).toBeGreaterThan(0.05);
    expect(track.samples[1].t).toBeCloseTo(0.5, 5);
    const xs = track.samples.map((sample) => sample.cx);
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
    // Smoothed: the crop trails the subject instead of snapping frame to frame.
    expect(xs[xs.length - 1] - xs[0]).toBeLessThan(0.1);
  });

  it("reports nothing to frame on when there is no speaker", () => {
    const blank: RawFrame = { data: new Uint8Array(FRAME_W * FRAME_H * 3).fill(40), width: FRAME_W, height: FRAME_H };
    const track = trackSubject([blank, blank]);
    expect(track.samples).toHaveLength(0);
    expect(track.confidence).toBe(0);
  });

  it("keeps a camera overlay small, so the planner knows to keep the screen", () => {
    const frames = [0, 0.01, 0.02].map((shift) =>
      frameWith([{ x: 0.78 + shift, y: 0.72, w: 0.09, h: 0.14 }])
    );
    const track = trackSubject(frames, 2);
    expect(track.samples.length).toBe(3);
    expect(track.area).toBeLessThan(0.06);
    expect(track.samples[0].cx).toBeGreaterThan(0.7);
  });
});
