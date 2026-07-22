import { describe, expect, it } from "vitest";
import {
  buildClipSegments,
  clipEditedDurationSec,
  keptClipRanges,
  remapClipCaptions,
  resizeClipSegmentBoundary,
  setClipSilenceEnabled
} from "@/lib/clipping/segments";
import type { CaptionSegment } from "@/types/domain";

const captions: CaptionSegment[] = [
  {
    id: "cap-1",
    start: 1,
    end: 2,
    text: "hello world",
    enabled: true,
    words: [
      { text: "hello", start: 1, end: 1.35 },
      { text: "world", start: 1.45, end: 2 }
    ]
  },
  {
    id: "cap-2",
    start: 3,
    end: 4,
    text: "back again",
    enabled: true,
    words: [
      { text: "back", start: 3, end: 3.4 },
      { text: "again", start: 3.5, end: 4 }
    ]
  }
];

describe("clip silence segments", () => {
  it("tiles the clip and disables detected leading, internal, and trailing silence", () => {
    const segments = buildClipSegments(5, captions, { minSilenceSec: 0.45, paddingSec: 0.1 });
    expect(segments[0]).toMatchObject({ start: 0, end: 0.9, kind: "silence", enabled: false });
    expect(segments.some((segment) => segment.kind === "silence" && segment.start === 2.1 && segment.end === 2.9)).toBe(true);
    expect(segments[segments.length - 1]).toMatchObject({ start: 4.1, end: 5, kind: "silence", enabled: false });
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].start).toBeCloseTo(segments[index - 1].end, 3);
    }
  });

  it("puts all silent gaps back without rebuilding the plan", () => {
    const segments = buildClipSegments(5, captions);
    const included = setClipSilenceEnabled(segments, true);
    expect(included.every((segment) => segment.enabled)).toBe(true);
  });

  it("changes a cut length by moving the shared segment boundary", () => {
    const segments = buildClipSegments(5, captions, { minSilenceSec: 0.45, paddingSec: 0.1 });
    const left = segments[0];
    const resized = resizeClipSegmentBoundary(segments, left.id, left.end - 0.2);
    expect(resized[0].end).toBeCloseTo(left.end - 0.2, 3);
    expect(resized[1].start).toBeCloseTo(resized[0].end, 3);
  });

  it("merges kept ranges and reports the actual edited duration", () => {
    const segments = buildClipSegments(5, captions, { minSilenceSec: 0.45, paddingSec: 0.1 });
    const ranges = keptClipRanges(5, 0, 5, segments);
    const total = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    expect(clipEditedDurationSec(5, 0, 5, segments)).toBeCloseTo(total, 3);
    expect(total).toBeLessThan(5);
  });

  it("moves captions back by the silent gaps removed before them", () => {
    const segments = buildClipSegments(5, captions, { minSilenceSec: 0.45, paddingSec: 0.1 });
    const remapped = remapClipCaptions(captions, keptClipRanges(5, 0, 5, segments));
    expect(remapped).toHaveLength(2);
    expect(remapped[0].start).toBeCloseTo(0.1, 3);
    expect(remapped[1].start).toBeLessThan(captions[1].start);
  });
});
