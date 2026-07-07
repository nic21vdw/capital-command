import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACE,
  applyManualRange,
  buildSegments,
  editedDurationSec,
  exportRanges,
  hookCaptions,
  keptRanges,
  planHook,
  planHookEnd,
  sourceTimeToOutput,
  sourceToOutputIntervals
} from "@/lib/longform/plan";
import type { LongformHook, LongformSegment } from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

function caption(id: string, start: number, end: number, text: string): CaptionSegment {
  const words = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, words.length);
  return {
    id,
    start,
    end,
    text,
    enabled: true,
    words: words.map((word, index) => ({
      text: word,
      start: start + index * step,
      end: start + (index + 1) * step
    }))
  };
}

function hookWith(partial: Partial<LongformHook>): LongformHook {
  return { ...planHook([], 60), ...partial };
}

describe("buildSegments", () => {
  it("cuts qualifying silences and keeps the speech around them", () => {
    const segments = buildSegments(30, [{ start: 10, end: 12 }], DEFAULT_PACE);
    expect(segments.map((s) => s.kind)).toEqual(["speech", "silence", "speech"]);
    const silence = segments[1];
    expect(silence.enabled).toBe(false);
    // Padding leaves breathing room on both sides of the cut.
    expect(silence.start).toBeCloseTo(10 + DEFAULT_PACE.paddingSec, 3);
    expect(silence.end).toBeCloseTo(12 - DEFAULT_PACE.paddingSec, 3);
    expect(segments[0]).toMatchObject({ start: 0, enabled: true });
    expect(segments[2].end).toBeCloseTo(30, 3);
  });

  it("keeps silences shorter than the pace threshold", () => {
    const segments = buildSegments(30, [{ start: 10, end: 10.4 }], DEFAULT_PACE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, kind: "speech", enabled: true });
  });

  it("covers the full duration with no gaps or overlaps", () => {
    const segments = buildSegments(
      120,
      [
        { start: 5, end: 7 },
        { start: 30, end: 33 },
        { start: 100, end: 110 }
      ],
      DEFAULT_PACE
    );
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBeCloseTo(120, 3);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBeCloseTo(segments[i - 1].end, 3);
    }
  });

  it("handles overlapping/out-of-order silences without going backwards", () => {
    const segments = buildSegments(
      60,
      [
        { start: 20, end: 24 },
        { start: 10, end: 13 },
        { start: 12, end: 14 }
      ],
      DEFAULT_PACE
    );
    for (const segment of segments) {
      expect(segment.end).toBeGreaterThan(segment.start);
    }
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBeGreaterThanOrEqual(segments[i - 1].end - 0.001);
    }
  });

  it("returns a single kept segment when there are no silences", () => {
    expect(buildSegments(45, [], DEFAULT_PACE)).toEqual([
      { id: "seg-1", start: 0, end: 45, kind: "speech", enabled: true }
    ]);
  });
});

describe("planHookEnd", () => {
  it("defaults to ~7s without a transcript", () => {
    expect(planHookEnd([], 600)).toBe(7);
  });

  it("clamps to the video length for very short videos", () => {
    expect(planHookEnd([], 6)).toBeLessThanOrEqual(6);
  });

  it("snaps to a completed thought near the target", () => {
    const transcript = [
      caption("c1", 0, 3, "Here is the secret nobody tells you."),
      caption("c2", 3.2, 8.1, "It changed everything about how I edit."),
      caption("c3", 8.4, 15, "Let me show you the whole system now.")
    ];
    expect(planHookEnd(transcript, 600)).toBeCloseTo(8.1, 3);
  });
});

describe("hookCaptions", () => {
  it("re-chunks the hook window into short punchy segments", () => {
    const transcript = [caption("c1", 0, 6, "one two three four five six seven eight")];
    const chunks = hookCaptions(transcript, 6);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.words.length).toBeLessThanOrEqual(3);
      expect(chunk.enabled).toBe(true);
    }
  });

  it("only includes words inside the hook window", () => {
    const transcript = [caption("c1", 0, 20, "a b c d e f g h i j k l m n o p q r s t")];
    const chunks = hookCaptions(transcript, 5);
    for (const chunk of chunks) {
      expect(chunk.end).toBeLessThanOrEqual(5.01);
    }
  });
});

describe("applyManualRange", () => {
  const base: LongformSegment[] = [{ id: "seg-1", start: 0, end: 30, kind: "speech", enabled: true }];

  it("carves a cut out of the middle of a kept segment", () => {
    const result = applyManualRange(base, 10, 15, false);
    expect(result).toEqual([
      { id: "seg-1", start: 0, end: 10, kind: "speech", enabled: true },
      { id: "seg-2", start: 10, end: 15, kind: "speech", enabled: false },
      { id: "seg-3", start: 15, end: 30, kind: "speech", enabled: true }
    ]);
    // The trimmed span drops out of the kept ranges.
    expect(keptRanges(result)).toEqual([
      { start: 0, end: 10 },
      { start: 15, end: 30 }
    ]);
  });

  it("keeps ids unique after repeated trims", () => {
    let segments = applyManualRange(base, 5, 8, false);
    segments = applyManualRange(segments, 20, 24, false);
    const ids = segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(keptRanges(segments)).toEqual([
      { start: 0, end: 5 },
      { start: 8, end: 20 },
      { start: 24, end: 30 }
    ]);
  });

  it("splits across segment boundaries and flips only the overlap", () => {
    const segments: LongformSegment[] = [
      { id: "a", start: 0, end: 10, kind: "speech", enabled: true },
      { id: "b", start: 10, end: 14, kind: "silence", enabled: false },
      { id: "c", start: 14, end: 30, kind: "speech", enabled: true }
    ];
    const result = applyManualRange(segments, 8, 20, false);
    // Everything in [8, 20] is now cut; the kinds are preserved.
    expect(keptRanges(result)).toEqual([
      { start: 0, end: 8 },
      { start: 20, end: 30 }
    ]);
    expect(result.every((s) => (s.start >= 8 && s.end <= 20 ? !s.enabled : true))).toBe(true);
  });

  it("restores a previously trimmed span when enabled is true", () => {
    const cut = applyManualRange(base, 10, 15, false);
    const restored = applyManualRange(cut, 10, 15, true);
    expect(keptRanges(restored)).toEqual([{ start: 0, end: 30 }]);
  });

  it("ignores selections that are too small to matter", () => {
    expect(applyManualRange(base, 10, 10.02, false)).toBe(base);
  });
});

describe("keptRanges", () => {
  const segments: LongformSegment[] = [
    { id: "1", start: 0, end: 10, kind: "speech", enabled: true },
    { id: "2", start: 10, end: 12, kind: "silence", enabled: false },
    { id: "3", start: 12, end: 20, kind: "speech", enabled: true },
    { id: "4", start: 20, end: 21, kind: "silence", enabled: true },
    { id: "5", start: 21, end: 30, kind: "speech", enabled: true }
  ];

  it("merges contiguous enabled segments into one range", () => {
    expect(keptRanges(segments)).toEqual([
      { start: 0, end: 10 },
      { start: 12, end: 30 }
    ]);
  });

  it("drops disabled segments entirely", () => {
    const allCut = segments.map((s) => ({ ...s, enabled: false }));
    expect(keptRanges(allCut)).toEqual([]);
  });
});

describe("exportRanges", () => {
  const segments: LongformSegment[] = [
    { id: "1", start: 0, end: 6, kind: "speech", enabled: true },
    { id: "2", start: 6, end: 8, kind: "silence", enabled: false },
    { id: "3", start: 8, end: 30, kind: "speech", enabled: true }
  ];

  it("plays the hook verbatim and clips body ranges to after it", () => {
    const { hookRange, bodyRanges } = exportRanges(segments, hookWith({ enabled: true, end: 7 }));
    expect(hookRange).toEqual({ start: 0, end: 7 });
    // The kept range 0-6 is entirely inside the hook; only 8-30 remains.
    expect(bodyRanges).toEqual([{ start: 8, end: 30 }]);
  });

  it("uses the kept ranges as-is when the hook is disabled", () => {
    const { hookRange, bodyRanges } = exportRanges(segments, hookWith({ enabled: false }));
    expect(hookRange).toBeNull();
    expect(bodyRanges).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 30 }
    ]);
  });

  it("trims a kept range that straddles the hook boundary", () => {
    const straddle: LongformSegment[] = [{ id: "1", start: 0, end: 30, kind: "speech", enabled: true }];
    const { bodyRanges } = exportRanges(straddle, hookWith({ enabled: true, end: 7 }));
    expect(bodyRanges).toEqual([{ start: 7, end: 30 }]);
  });
});

describe("editedDurationSec", () => {
  it("sums the hook and the kept body time", () => {
    const segments: LongformSegment[] = [
      { id: "1", start: 0, end: 10, kind: "speech", enabled: true },
      { id: "2", start: 10, end: 14, kind: "silence", enabled: false },
      { id: "3", start: 14, end: 34, kind: "speech", enabled: true }
    ];
    // Hook 0-7 plays verbatim; body keeps 7-10 and 14-34 => 7 + 3 + 20 = 30.
    expect(editedDurationSec(segments, hookWith({ enabled: true, end: 7 }))).toBeCloseTo(30, 3);
    // Without the hook it's just the kept segments: 10 + 20.
    expect(editedDurationSec(segments, hookWith({ enabled: false }))).toBeCloseTo(30, 3);
  });
});

describe("sourceToOutputIntervals", () => {
  const segments: LongformSegment[] = [
    { id: "1", start: 0, end: 20, kind: "speech", enabled: true },
    { id: "2", start: 20, end: 25, kind: "silence", enabled: false },
    { id: "3", start: 25, end: 40, kind: "speech", enabled: true }
  ];
  const hook = hookWith({ enabled: true, end: 5 });

  it("maps a span across the hook/body seam to one contiguous output interval", () => {
    // Hook 0-5 plays verbatim then body starts at output 5, so 3-7 stays whole.
    expect(sourceToOutputIntervals(3, 7, segments, hook)).toEqual([{ start: 3, end: 7 }]);
  });

  it("drops the part of a span that falls inside cut footage", () => {
    // 22-27 straddles the cut 20-25; only 25-27 survives, landing at output 20-22.
    expect(sourceToOutputIntervals(22, 27, segments, hook)).toEqual([{ start: 20, end: 22 }]);
  });

  it("returns nothing for a span entirely inside a cut", () => {
    expect(sourceToOutputIntervals(21, 24, segments, hook)).toEqual([]);
  });

  it("shifts body-only spans back by the removed dead space", () => {
    // 30-35 is well past the cut: body offset is 5 (hook) + kept 5-20 => output 20 at src 25.
    expect(sourceToOutputIntervals(30, 35, segments, hook)).toEqual([{ start: 25, end: 30 }]);
  });
});

describe("sourceTimeToOutput", () => {
  const segments: LongformSegment[] = [
    { id: "1", start: 0, end: 20, kind: "speech", enabled: true },
    { id: "2", start: 20, end: 25, kind: "silence", enabled: false },
    { id: "3", start: 25, end: 40, kind: "speech", enabled: true }
  ];
  const hook = hookWith({ enabled: true, end: 5 });

  it("maps a kept instant straight through", () => {
    // Hook plays verbatim then the body continues, so 10s stays at output 10.
    expect(sourceTimeToOutput(10, segments, hook)).toBe(10);
  });

  it("shifts a point after a cut back by the removed dead space", () => {
    // src 30 sits 5s into the second speech block, which starts at output 20.
    expect(sourceTimeToOutput(30, segments, hook)).toBe(25);
  });

  it("snaps a point inside a cut forward to the next kept footage", () => {
    // 22 is inside the cut 20-25; the next kept footage begins at output 20.
    expect(sourceTimeToOutput(22, segments, hook)).toBe(20);
  });

  it("clamps a point past the end to the edit's runtime", () => {
    expect(sourceTimeToOutput(100, segments, hook)).toBe(editedDurationSec(segments, hook));
  });

  it("returns null when the whole edit is empty", () => {
    const allCut = segments.map((seg) => ({ ...seg, enabled: false }));
    expect(sourceTimeToOutput(10, allCut, hookWith({ enabled: false, end: 0 }))).toBeNull();
  });
});
