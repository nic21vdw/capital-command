import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_SLIDE,
  candidateTimes,
  frameScore,
  frameSignature,
  frameStats,
  frameTargets,
  pickCandidate,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  signatureDistance
} from "@/lib/carousels/videoFrames";

const SIZE = SAMPLE_WIDTH * SAMPLE_HEIGHT;

function solid(value: number): Uint8Array {
  return new Uint8Array(SIZE).fill(value);
}

/** A frame with real structure in it: sharp vertical bars at mid brightness. */
function bars(period: number, low = 40, high = 210): Uint8Array {
  const gray = new Uint8Array(SIZE);
  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
      gray[y * SAMPLE_WIDTH + x] = Math.floor(x / period) % 2 === 0 ? low : high;
    }
  }
  return gray;
}

/** The same picture with the edges smeared — what a camera move looks like. */
function blurred(source: Uint8Array): Uint8Array {
  const gray = new Uint8Array(SIZE);
  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -3; dx <= 3; dx += 1) {
        const sx = Math.min(SAMPLE_WIDTH - 1, Math.max(0, x + dx));
        sum += source[y * SAMPLE_WIDTH + sx];
        count += 1;
      }
      gray[y * SAMPLE_WIDTH + x] = Math.round(sum / count);
    }
  }
  return gray;
}

describe("frameStats", () => {
  it("reads a black frame as dark and flat", () => {
    const stats = frameStats(solid(4));
    expect(stats.brightness).toBeLessThan(0.05);
    expect(stats.detail).toBe(0);
    expect(stats.sharpness).toBe(0);
  });

  it("reads a detailed frame as bright, contrasty and sharp", () => {
    const stats = frameStats(bars(4));
    expect(stats.brightness).toBeGreaterThan(0.3);
    expect(stats.detail).toBeGreaterThan(0.5);
    expect(stats.sharpness).toBeGreaterThan(0.3);
  });
});

describe("frameScore", () => {
  it("rejects fades to black and blown-out flashes outright", () => {
    expect(frameScore(frameStats(solid(3)))).toBe(0);
    expect(frameScore(frameStats(solid(252)))).toBe(0);
  });

  it("rejects a flat frame even at a good exposure", () => {
    expect(frameScore(frameStats(solid(120)))).toBe(0);
  });

  it("prefers a sharp frame over the same frame blurred", () => {
    const sharp = bars(4);
    expect(frameScore(frameStats(sharp))).toBeGreaterThan(frameScore(frameStats(blurred(sharp))));
  });

  it("prefers a well-lit frame over an underexposed one", () => {
    expect(frameScore(frameStats(bars(4, 40, 210)))).toBeGreaterThan(frameScore(frameStats(bars(4, 6, 40))));
  });
});

describe("frameTargets", () => {
  it("spreads the slides across the video, clear of both ends", () => {
    const targets = frameTargets(600, 8);
    expect(targets).toHaveLength(8);
    expect(targets[0]).toBeGreaterThan(30);
    expect(targets[7]).toBeLessThan(570);
    expect([...targets].sort((a, b) => a - b)).toEqual(targets);
  });

  it("returns nothing for a video with no duration", () => {
    expect(frameTargets(0, 8)).toEqual([]);
    expect(frameTargets(600, 0)).toEqual([]);
  });
});

describe("candidateTimes", () => {
  it("looks around the target, nearest first", () => {
    const times = candidateTimes(120, 600);
    expect(times[0]).toBe(120);
    expect(times).toHaveLength(CANDIDATES_PER_SLIDE);
    // Short window: a screen-share is a different application ten seconds away.
    expect(Math.max(...times.map((time) => Math.abs(time - 120)))).toBeLessThanOrEqual(5);
  });

  it("never seeks past the end of the video or before the start", () => {
    for (const seconds of candidateTimes(1, 8)) {
      expect(seconds).toBeGreaterThanOrEqual(0);
      expect(seconds).toBeLessThanOrEqual(7.5);
    }
  });
});

describe("pickCandidate", () => {
  const signature = (value: number) => new Array(64).fill(value);

  it("returns nothing when every candidate is unusable", () => {
    expect(pickCandidate([{ seconds: 5, score: 0, signature: signature(0) }], [])).toBeNull();
  });

  it("takes the best-looking candidate", () => {
    const pick = pickCandidate(
      [
        { seconds: 5, score: 0.4, signature: signature(0.2) },
        { seconds: 11, score: 0.7, signature: signature(0.5) }
      ],
      []
    );
    expect(pick?.seconds).toBe(11);
  });

  it("stays on the anchor when a slightly better frame is seconds away", () => {
    const pick = pickCandidate(
      [
        { seconds: 100, score: 0.6, signature: signature(0.2) },
        { seconds: 104, score: 0.7, signature: signature(0.5) }
      ],
      [],
      100
    );
    expect(pick?.seconds).toBe(100);
  });

  it("still leaves the anchor when the frame there is much worse", () => {
    const pick = pickCandidate(
      [
        { seconds: 100, score: 0.1, signature: signature(0.2) },
        { seconds: 104, score: 0.9, signature: signature(0.5) }
      ],
      [],
      100
    );
    expect(pick?.seconds).toBe(104);
  });

  it("passes over a frame that looks like one already used", () => {
    const pick = pickCandidate(
      [
        { seconds: 5, score: 0.7, signature: signature(0.5) },
        { seconds: 11, score: 0.4, signature: signature(0.1) }
      ],
      [signature(0.5)]
    );
    expect(pick?.seconds).toBe(11);
  });

  it("still returns a repeat when it is the only thing in shot", () => {
    const pick = pickCandidate([{ seconds: 5, score: 0.7, signature: signature(0.5) }], [signature(0.5)]);
    expect(pick?.seconds).toBe(5);
  });
});

describe("frameSignature", () => {
  it("is far apart for different pictures and close for the same one", () => {
    const a = frameSignature(bars(4));
    const b = frameSignature(bars(4));
    const c = frameSignature(solid(20));
    expect(signatureDistance(a, b)).toBeLessThan(0.01);
    expect(signatureDistance(a, c)).toBeGreaterThan(0.2);
  });
});
