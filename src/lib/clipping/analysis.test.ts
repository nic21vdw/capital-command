import { describe, expect, it } from "vitest";
import {
  createSilenceCollector,
  fallbackCandidates,
  selectCandidates,
  TARGET_CLIP_COUNT,
  type EnergyWindow
} from "./analysis";

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

describe("createSilenceCollector", () => {
  it("pairs silence_start/silence_end lines into ranges, ignoring other output", () => {
    const collector = createSilenceCollector();
    collector.onLine("[silencedetect @ 0x55d] silence_start: 12.5");
    collector.onLine("size=N/A time=00:00:14.00 bitrate=N/A speed=98x");
    collector.onLine("[silencedetect @ 0x55d] silence_end: 14.25 | silence_duration: 1.75");
    expect(collector.ranges).toEqual([{ start: 12.5, end: 14.25 }]);
  });

  it("drops a trailing silence_start with no end, and an end with no start", () => {
    const collector = createSilenceCollector();
    collector.onLine("[silencedetect @ 0x55d] silence_end: 2.0 | silence_duration: 2.0");
    collector.onLine("[silencedetect @ 0x55d] silence_start: 100");
    expect(collector.ranges).toEqual([]);
  });

  it("collects every silence of a stream-length recording, not just the tail", () => {
    // An 8-hour stream with a pause every ~4s logs far more silencedetect
    // output than runFfmpeg's 400 KB captured-stderr cap; parsing must be
    // incremental so the early hours keep their cuts.
    const collector = createSilenceCollector();
    const count = 7200;
    for (let i = 0; i < count; i++) {
      const start = i * 4 + 3;
      collector.onLine(`[silencedetect @ 0x55d] silence_start: ${start}`);
      collector.onLine(`[silencedetect @ 0x55d] silence_end: ${start + 1} | silence_duration: 1`);
    }
    expect(collector.ranges).toHaveLength(count);
    expect(collector.ranges[0]).toEqual({ start: 3, end: 4 });
    expect(collector.ranges[count - 1]).toEqual({ start: (count - 1) * 4 + 3, end: (count - 1) * 4 + 4 });
  });
});
