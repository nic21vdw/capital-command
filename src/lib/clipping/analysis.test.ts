import { describe, expect, it, vi } from "vitest";
import type { FfmpegOptions } from "./ffmpeg";
import {
  clampClipCount,
  createEnergyCollector,
  extractEnergy,
  createSilenceCollector,
  fallbackCandidates,
  MAX_CLIP_COUNT,
  MIN_CLIP_COUNT,
  selectCandidates,
  TARGET_CLIP_COUNT,
  type EnergyWindow
} from "./analysis";

const ffmpegRun = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clipping/ffmpeg", () => ({ runFfmpeg: ffmpegRun }));

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

  it("honours a creator-chosen clip count in both selection paths", () => {
    // A long stream so there is room for far more than the default ten clips.
    const duration = 60 * 90;
    expect(fallbackCandidates(duration, "No signal", 25)).toHaveLength(25);

    const audio = selectCandidates(streamWindows(duration), [], duration, [], 25);
    expect(audio).toHaveLength(25);
    expect(audio.map((candidate) => candidate.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => `clip-${index + 1}`)
    );
  });

  it("never returns more clips than requested", () => {
    const duration = 60 * 90;
    expect(fallbackCandidates(duration, "No signal", 3)).toHaveLength(3);
    expect(selectCandidates(streamWindows(duration), [], duration, [], 3)).toHaveLength(3);
  });
});

describe("clampClipCount", () => {
  it("defaults when the value is missing or unparseable", () => {
    expect(clampClipCount(undefined)).toBe(TARGET_CLIP_COUNT);
    expect(clampClipCount(null)).toBe(TARGET_CLIP_COUNT);
    expect(clampClipCount(Number.NaN)).toBe(TARGET_CLIP_COUNT);
  });

  it("clamps to the supported range and rounds fractional values", () => {
    expect(clampClipCount(0)).toBe(MIN_CLIP_COUNT);
    expect(clampClipCount(-4)).toBe(MIN_CLIP_COUNT);
    expect(clampClipCount(1000)).toBe(MAX_CLIP_COUNT);
    expect(clampClipCount(12.4)).toBe(12);
    expect(clampClipCount(12.6)).toBe(13);
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

describe("createEnergyCollector", () => {
  it("pairs timestamps with finite and silent RMS records and ignores unrelated lines", () => {
    const collector = createEnergyCollector();
    collector.onLine("lavfi.astats.Overall.RMS_level=-12");
    collector.onLine("frame:0 pts:0 pts_time:0");
    collector.onLine("lavfi.astats.Overall.RMS_level=-20.5");
    collector.onLine("frame:1 pts:8000 pts_time:0.5");
    collector.onLine("unrelated diagnostic");
    collector.onLine("lavfi.astats.Overall.RMS_level=-inf");
    collector.onLine("frame:2 pts:16000 pts_time:1");
    collector.onLine("lavfi.astats.Overall.RMS_level=-120");
    expect(collector.windows).toEqual([
      { time: 0, rms: -20.5 },
      { time: 0.5, rms: -90 },
      { time: 1, rms: -90 }
    ]);
  });

  it("retains early and late energy windows from an eight-hour recording", () => {
    const collector = createEnergyCollector();
    const count = 8 * 60 * 60 * 2;
    for (let i = 0; i < count; i += 1) {
      collector.onLine(`frame:${i} pts_time:${i / 2}`);
      collector.onLine("lavfi.astats.Overall.RMS_level=-24");
    }
    expect(collector.windows).toHaveLength(count);
    expect(collector.windows[0]).toEqual({ time: 0, rms: -24 });
    expect(collector.windows[count - 1]).toEqual({ time: (count - 1) / 2, rms: -24 });
  });
});

describe("extractEnergy streaming", () => {
  it("uses stdout callbacks instead of asking FFmpeg to retain the analysis log", async () => {
    ffmpegRun.mockImplementationOnce(async (_args: string[], options: FfmpegOptions) => {
      expect(options.captureStdout).toBe(false);
      options.onStdoutLine?.("frame:0 pts_time:0");
      options.onStdoutLine?.("lavfi.astats.Overall.RMS_level=-18");
      options.onStdoutLine?.("frame:1 pts_time:0.5");
      options.onStdoutLine?.("lavfi.astats.Overall.RMS_level=-inf");
      return { stdout: "", stderr: "", code: 0 };
    });
    await expect(extractEnergy("long-recording.mp3")).resolves.toEqual([
      { time: 0, rms: -18 },
      { time: 0.5, rms: -90 }
    ]);
  });
});
