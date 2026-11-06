import { describe, expect, it } from "vitest";
import { holdThenMove, pickSpeakerFace, planFaceFraming, type FaceBox, type FaceFrame } from "./face";
import type { FramingTarget } from "./framing";

const target: FramingTarget = { sourceW: 1920, sourceH: 1080, targetW: 1080, targetH: 1920 };

function face(x: number, y: number, w: number, h: number, score = 0.92): FaceBox {
  return { x, y, w, h, score };
}

function frames(count: number, make: (index: number) => FaceBox[]): FaceFrame[] {
  return Array.from({ length: count }, (_, index) => ({ t: index / 2, faces: make(index) }));
}

describe("pickSpeakerFace", () => {
  it("follows the face that stays put, not one that flashes past on the screen", () => {
    const track = pickSpeakerFace(
      frames(20, (i) => (i < 4 ? [face(0.3, 0.28, 0.13, 0.3), face(0.75, 0.1, 0.2, 0.4, 0.95)] : [face(0.3, 0.28, 0.13, 0.3)]))
    );
    expect(track).not.toBeNull();
    expect(track!.cx).toBeCloseTo(0.365, 2);
    expect(track!.presence).toBe(1);
  });

  it("returns null when the speaker is barely on screen", () => {
    expect(pickSpeakerFace(frames(20, (i) => (i < 5 ? [face(0.3, 0.3, 0.1, 0.2)] : [])))).toBeNull();
  });

  it("ignores weak detections", () => {
    expect(pickSpeakerFace(frames(10, () => [face(0.3, 0.3, 0.1, 0.2, 0.5)]))).toBeNull();
  });

  it("holds the last position through frames where the face is missed", () => {
    const track = pickSpeakerFace(frames(10, (i) => (i % 3 === 0 ? [] : [face(0.4, 0.3, 0.12, 0.3)])))!;
    expect(track.samples).toHaveLength(10);
    expect(new Set(track.samples.map((s) => s.cx.toFixed(3))).size).toBe(1);
  });
});

describe("planFaceFraming", () => {
  it("crops a camera shot full height around the face", () => {
    const framing = planFaceFraming(pickSpeakerFace(frames(10, () => [face(0.3, 0.28, 0.13, 0.3)])), target)!;
    expect(framing.mode).toBe("subject-fill");
    expect(framing.crop!.h).toBe(1);
    expect(framing.crop!.w).toBeCloseTo(0.316, 2);
    const x = framing.keyframes![0].x;
    expect(x).toBeLessThan(0.365);
    expect(x + framing.crop!.w).toBeGreaterThan(0.365);
    expect(new Set(framing.keyframes!.map((k) => k.x)).size).toBe(1);
  });

  it("leads with a small camera overlay instead of cropping into the screen", () => {
    const framing = planFaceFraming(pickSpeakerFace(frames(10, () => [face(0.85, 0.75, 0.04, 0.07)])), target)!;
    expect(framing.mode).toBe("speaker-stack");
    expect(framing.faceSource!.x + framing.faceSource!.w).toBeLessThanOrEqual(1);
  });

  it("gives nothing back without a face, so the old detector runs", () => {
    expect(planFaceFraming(null, target)).toBeNull();
  });
});

describe("holdThenMove", () => {
  it("holds still through small drift and moves once for a real change", () => {
    const points = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((t) => ({ t, x: t < 2 ? 0.2 + t * 0.01 : 0.45, y: 0 }));
    const held = holdThenMove(points, 0.05);
    expect(held[0]).toEqual({ t: 0, x: 0.2, y: 0 });
    expect(held.some((k) => k.t === 1.4 && k.x === 0.2)).toBe(true);
    expect(held.some((k) => k.t === 2 && k.x === 0.45)).toBe(true);
    expect(held.at(-1)!.t).toBe(3);
  });
});
