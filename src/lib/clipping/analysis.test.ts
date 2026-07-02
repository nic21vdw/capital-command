import { describe, expect, it } from "vitest";
import { fallbackCandidates, selectCandidates, TARGET_CLIP_COUNT, type EnergyWindow } from "./analysis";

function streamWindows(durationSec: number, rms = -24): EnergyWindow[] {
  const windows: EnergyWindow[] = [];
  for (let time = 0; time < durationSec; time += 0.5) {
    windows.push({ time, rms });
  }
  return windows;
}

describe("clip candidate selection", () => {
  it("targets ten fallback clips for long streams", () => {
    const candidates = fallbackCandidates(60 * 45, "No signal");

    expect(candidates).toHaveLength(TARGET_CLIP_COUNT);
    expect(candidates[0].start).toBeGreaterThanOrEqual(0);
    expect(candidates[candidates.length - 1].end).toBeLessThanOrEqual(60 * 45);
  });

  it("fills audio selections up to the ten-clip target when enough stream time exists", () => {
    const candidates = selectCandidates(streamWindows(60 * 30), [], 60 * 30);

    expect(candidates).toHaveLength(TARGET_CLIP_COUNT);
    expect(candidates.map((candidate) => candidate.id)).toEqual(
      Array.from({ length: TARGET_CLIP_COUNT }, (_, index) => `clip-${index + 1}`)
    );
  });
});
