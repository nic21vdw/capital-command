import { describe, expect, it } from "vitest";
import { buildTimeline } from "./transcript-select";
import type { CaptionSegment } from "@/types/domain";

function seg(start: number, text: string): CaptionSegment {
  return { id: `s-${start}`, start, end: start + 4, text, words: [], enabled: true };
}

describe("buildTimeline", () => {
  it("covers the whole stream end-to-end, not just the start", () => {
    // A 2-hour stream with a line every 30s.
    const duration = 7200;
    const segments: CaptionSegment[] = [];
    for (let t = 0; t < duration; t += 30) segments.push(seg(t, `line at ${t}`));

    const timeline = buildTimeline(segments, duration);

    // The opening, a mid-stream moment, and the very end all make it in.
    expect(timeline).toContain("line at 0");
    expect(timeline).toContain("line at 3600");
    expect(timeline).toContain("line at 7170");
  });

  it("formats timestamps as h:mm:ss past the first hour", () => {
    const timeline = buildTimeline([seg(0, "hello"), seg(3700, "later")], 4000);
    expect(timeline).toContain("[00:00] hello");
    // Bucketed to the 6s grid (floor(3700/6)*6 = 3696 = 1:01:36).
    expect(timeline).toContain("[1:01:36] later");
  });

  it("keeps the line budget bounded for very long streams", () => {
    const duration = 36000; // 10 hours
    const segments: CaptionSegment[] = [];
    for (let t = 0; t < duration; t += 5) segments.push(seg(t, `t${t}`));

    const lines = buildTimeline(segments, duration).split("\n");
    expect(lines.length).toBeLessThanOrEqual(1500);
    // Still reaches the final stretch of the stream.
    expect(lines[lines.length - 1]).toContain("9:");
  });
});
