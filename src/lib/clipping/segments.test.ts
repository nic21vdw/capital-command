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

  it("removes cut words from timing and plain caption text without mutating the source", () => {
    const source: CaptionSegment = { id: "cut", start: 0, end: 1.6, text: "KEEP REMOVED LATER", enabled: true,
      words: [{ text: "KEEP", start: 0, end: 0.2 }, { text: "REMOVED", start: 0.6, end: 0.8 }, { text: "LATER", start: 1, end: 1.6 }] };
    const before = structuredClone(source);
    const [result] = remapClipCaptions([source], [{ start: 0, end: 0.4 }, { start: 1, end: 1.6 }]);
    expect(result.text).toBe("KEEP LATER");
    expect(result.words).toEqual([{ text: "KEEP", start: 0, end: 0.2 }, { text: "LATER", start: 0.4, end: 1 }]);
    expect(result.words.every((word) => word.end > word.start)).toBe(true);
    expect(source).toEqual(before);
  });

  it("retains positive partial intersections and short words but excludes boundary-only touches", () => {
    const source: CaptionSegment = { id: "edge", start: 0, end: 3, text: "LEFT SHORT PART RIGHT", enabled: true,
      words: [{ text: "LEFT", start: 0.8, end: 1 }, { text: "SHORT", start: 1, end: 1.01 },
        { text: "PART", start: 1.9, end: 2.2 }, { text: "RIGHT", start: 2, end: 2.4 }] };
    const [result] = remapClipCaptions([source], [{ start: 1, end: 2 }]);
    expect(result.text).toBe("SHORT PART");
    expect(result.words).toEqual([{ text: "SHORT", start: 0, end: 0.01 }, { text: "PART", start: 0.9, end: 1 }]);
  });

  it("omits a timed caption when all of its spoken words were removed", () => {
    const source: CaptionSegment = { id: "removed", start: 0, end: 2, text: "REMOVED", enabled: true,
      words: [{ text: "REMOVED", start: 0.8, end: 1.2 }] };
    expect(remapClipCaptions([source], [{ start: 0, end: 0.5 }, { start: 1.5, end: 2 }])).toEqual([]);
  });

  it("preserves untimed wording and untouched timed caption formatting", () => {
    const untimed: CaptionSegment = { id: "untimed", start: 0, end: 2, text: "Keep this\nwording intact.", enabled: true, words: [] };
    expect(remapClipCaptions([untimed], [{ start: 0, end: 0.5 }, { start: 1.5, end: 2 }])[0])
      .toMatchObject({ start: 0, end: 1, text: untimed.text, words: [] });
    const timed: CaptionSegment = { ...untimed, words: [{ text: "Keep", start: 0, end: 0.5 }, { text: "wording", start: 0.5, end: 1 }] };
    expect(remapClipCaptions([timed], [{ start: 0, end: 2 }])[0].text).toBe(timed.text);
  });
});
