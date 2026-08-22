import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACE,
  LONGFORM_CAPTION_STYLE,
  PACE_PRESETS,
  VIRAL_HOOK_CAPTION_STYLE,
  applyManualRange,
  buildSegments,
  editedDurationSec,
  exportRanges,
  hookCaptions,
  keptRanges,
  planCaptions,
  planHook,
  planHookEnd,
  paceDetection,
  remapCaptionsToOutput,
  resolvePace,
  sourceTimeToOutput,
  sourceToOutputIntervals,
  transcriptCaptions
} from "@/lib/longform/plan";
import type { LongformHook, LongformPace, LongformSegment } from "@/lib/longform/types";
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

  it("keeps a pause short enough to read as rhythm", () => {
    // Under maxKeptGapSec there is nothing to compress — a beat that short is
    // part of the delivery.
    const segments = buildSegments(30, [{ start: 10, end: 10.15 }], DEFAULT_PACE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, kind: "speech", enabled: true });
  });

  it("compresses a pause too short to qualify but longer than the kept gap", () => {
    // 0.5s at the Fast pace: below minSilenceSec is no longer a free pass, the
    // pause is squeezed down to maxKeptGapSec instead of surviving whole.
    const pace = { minSilenceSec: 0.8, paddingSec: 0.06, maxKeptGapSec: 0.22 };
    const segments = buildSegments(30, [{ start: 10, end: 10.5 }], pace);
    const cut = segments.find((segment) => segment.kind === "silence");
    expect(cut).toBeDefined();
    expect(cut!.enabled).toBe(false);
    const kept = 10.5 - 10 - (cut!.end - cut!.start);
    expect(kept).toBeCloseTo(0.22, 3);
  });

  it("never cuts outside a detected silence, so no word onset is clipped", () => {
    // The tight Fast padding (0.06s) is only safe because every cut is carved
    // from INSIDE the reported pause: the speech on both sides is untouched.
    const silences = [
      { start: 5, end: 5.4 },
      { start: 12, end: 14 },
      { start: 20, end: 20.5 },
      { start: 40, end: 55 }
    ];
    const segments = buildSegments(60, silences, DEFAULT_PACE);
    for (const cut of segments.filter((segment) => segment.kind === "silence")) {
      const source = silences.find((silence) => cut.start >= silence.start && cut.end <= silence.end);
      expect(source, `cut ${cut.start}-${cut.end} escaped its silence`).toBeDefined();
      expect(cut.start).toBeGreaterThanOrEqual(source!.start);
      expect(cut.end).toBeLessThanOrEqual(source!.end);
    }
  });

  it("leaves the speech on both sides of a cut whole", () => {
    const segments = buildSegments(30, [{ start: 10, end: 12 }], DEFAULT_PACE);
    const [before, , after] = segments;
    // Every frame of speech up to the pause survives, and the pause's own tail
    // is what plays before the next word — never any part of the word itself.
    expect(before.end).toBeGreaterThan(10);
    expect(after.start).toBeLessThan(12);
    expect(before.end).toBeCloseTo(10 + DEFAULT_PACE.paddingSec!, 3);
    expect(after.start).toBeCloseTo(12 - DEFAULT_PACE.paddingSec!, 3);
  });

  it("cuts a stream harder on the new default than the old one", () => {
    // The old Fast pace: 0.7s threshold, 0.15s padding, no gap clamp.
    const legacy = { minSilenceSec: 0.7, paddingSec: 0.15, maxKeptGapSec: Infinity };
    // A minute of talking with a mix of long and half-second pauses.
    const silences = Array.from({ length: 60 }, (_, i) => ({
      start: i * 5 + 3,
      end: i * 5 + 3 + (i % 3 === 0 ? 1.2 : 0.5)
    }));
    const removed = (pace: LongformPace) =>
      buildSegments(300, silences, pace)
        .filter((segment) => !segment.enabled)
        .reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    expect(removed(DEFAULT_PACE)).toBeGreaterThan(removed(legacy) * 1.5);
  });

  it("plans a full cut list for a stream-length recording", () => {
    // An 8-hour stream VOD with a pause every ~4 seconds: every qualifying
    // silence must become a cut — nothing caps or truncates the plan.
    const durationSec = 8 * 3600;
    const silences = Array.from({ length: 7200 }, (_, i) => ({ start: i * 4 + 3, end: i * 4 + 4 }));
    const segments = buildSegments(durationSec, silences, DEFAULT_PACE);
    const cuts = segments.filter((s) => s.kind === "silence" && !s.enabled);
    expect(cuts).toHaveLength(7200);
    // The tiling covers the whole recording with no gaps or overlaps.
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBeCloseTo(durationSec, 3);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBeCloseTo(segments[i - 1].end, 3);
    }
    // The last hour of the stream is still being cut, not just the start.
    expect(cuts[cuts.length - 1].start).toBeGreaterThan(7 * 3600);
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
  it("defaults to the full 30-second opening block without a transcript", () => {
    expect(planHookEnd([], 600)).toBe(30);
  });

  it("clamps to the video length for very short videos", () => {
    expect(planHookEnd([], 6)).toBeLessThanOrEqual(6);
  });

  it("snaps to a completed thought near the 30s target", () => {
    const transcript = [
      caption("c1", 0, 12, "Here is the secret nobody tells you about editing long videos."),
      caption("c2", 12.2, 28.6, "It changed everything about how I edit and how long it takes me."),
      caption("c3", 29, 48, "Let me show you the whole system now from the very beginning.")
    ];
    const end = planHookEnd(transcript, 600);
    expect(end).toBeCloseTo(28.6, 3);
    expect(end).toBeGreaterThanOrEqual(24);
    expect(end).toBeLessThanOrEqual(34);
  });

  it("keeps the whole first 30 seconds when the hook is moved later in the take", () => {
    expect(planHookEnd([], 600, 42)).toBe(72);
  });
});

describe("hookCaptions", () => {
  it("re-chunks the hook window into short punchy segments", () => {
    const transcript = [caption("c1", 0, 6, "one two three four five six seven eight")];
    const chunks = hookCaptions(transcript, 0, 6);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.words.length).toBeLessThanOrEqual(3);
      expect(chunk.enabled).toBe(true);
    }
  });

  it("only includes words inside the hook window", () => {
    const transcript = [caption("c1", 0, 20, "a b c d e f g h i j k l m n o p q r s t")];
    const chunks = hookCaptions(transcript, 0, 5);
    for (const chunk of chunks) {
      expect(chunk.end).toBeLessThanOrEqual(5.01);
    }
  });

  it("rebases a moved hook window to hook-local seconds", () => {
    // A hook pulled from 10-16s of the source must emit captions starting at 0
    // (the hook's own first frame), since the export burns them onto the clip
    // it trimmed out of the middle.
    const transcript = [caption("c1", 10, 16, "one two three four five six")];
    const chunks = hookCaptions(transcript, 10, 16);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].start).toBeCloseTo(0, 3);
    for (const chunk of chunks) {
      expect(chunk.end).toBeLessThanOrEqual(6.01);
      for (const word of chunk.words) expect(word.start).toBeGreaterThanOrEqual(-0.001);
    }
  });
});

describe("transcriptCaptions", () => {
  it("re-chunks the whole transcript into readable segments", () => {
    const transcript = [
      caption("c1", 0, 6, "one two three four five six seven eight"),
      caption("c2", 7, 12, "nine ten eleven twelve")
    ];
    const chunks = transcriptCaptions(transcript, 5);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.words.length).toBeLessThanOrEqual(5);
      expect(chunk.enabled).toBe(true);
    }
    // Every word of the source survives the re-chunk.
    const words = chunks.flatMap((chunk) => chunk.words.map((w) => w.text));
    expect(words).toHaveLength(12);
  });

  it("keeps phrase segments as-is when the transcript has no word timing", () => {
    const transcript: CaptionSegment[] = [
      { id: "c1", start: 0, end: 4, text: "hello there", words: [], enabled: true }
    ];
    const chunks = transcriptCaptions(transcript, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ start: 0, end: 4, text: "hello there" });
  });
});

describe("caption placement", () => {
  // Burning words across the middle of a 16:9 upload covers the screen-share,
  // the editor and the face — the video the words are about. Subtitles sit in
  // the lower third, and both long-form looks do.
  it("keeps both long-form caption styles in the subtitle band", () => {
    expect(LONGFORM_CAPTION_STYLE.position).toBe("lower-third");
    expect(VIRAL_HOOK_CAPTION_STYLE.position).toBe("lower-third");
    expect(LONGFORM_CAPTION_STYLE.alignment).toBe("center");
    expect(VIRAL_HOOK_CAPTION_STYLE.alignment).toBe("center");
  });

  it("still opens louder than it captions the body", () => {
    expect(VIRAL_HOOK_CAPTION_STYLE.fontScale).toBeGreaterThan(LONGFORM_CAPTION_STYLE.fontScale);
    expect(VIRAL_HOOK_CAPTION_STYLE.uppercase).toBe(true);
  });
});

describe("planCaptions", () => {
  it("starts switched on so every long-form upload carries subtitles", () => {
    const plan = planCaptions([caption("c1", 0, 5, "one two three")]);
    expect(plan.enabled).toBe(true);
    expect(plan.highlightCurrentWord).toBe(true);
    expect(plan.segments.length).toBeGreaterThan(0);
  });
});

describe("remapCaptionsToOutput", () => {
  const segments: LongformSegment[] = [
    { id: "1", start: 0, end: 20, kind: "speech", enabled: true },
    { id: "2", start: 20, end: 25, kind: "silence", enabled: false },
    { id: "3", start: 25, end: 40, kind: "speech", enabled: true }
  ];
  const hook = hookWith({ enabled: true, end: 5 });

  it("passes kept captions straight through", () => {
    const [seg] = remapCaptionsToOutput([caption("c1", 10, 13, "a b c")], segments, hook);
    expect(seg.start).toBeCloseTo(10, 3);
    expect(seg.end).toBeCloseTo(13, 3);
    expect(seg.words.map((w) => w.text)).toEqual(["a", "b", "c"]);
  });

  it("shifts captions after a cut back by the removed dead space", () => {
    const [seg] = remapCaptionsToOutput([caption("c1", 30, 33, "a b c")], segments, hook);
    // The 5s cut at 20-25 pulls everything after it 5s earlier.
    expect(seg.start).toBeCloseTo(25, 3);
    expect(seg.end).toBeCloseTo(28, 3);
    expect(seg.words[0].start).toBeCloseTo(25, 3);
  });

  it("drops captions entirely inside cut footage", () => {
    expect(remapCaptionsToOutput([caption("c1", 21, 24, "gone")], segments, hook)).toEqual([]);
  });

  it("shortens a caption straddling a cut and snaps its words to the jump", () => {
    const [seg] = remapCaptionsToOutput([caption("c1", 18, 28, "a b c d e")], segments, hook);
    // 18-20 plays, 20-25 is cut, 25-28 plays at output 20-23.
    expect(seg.start).toBeCloseTo(18, 3);
    expect(seg.end).toBeCloseTo(23, 3);
    for (const word of seg.words) {
      expect(word.start).toBeGreaterThanOrEqual(seg.start);
      expect(word.end).toBeLessThanOrEqual(seg.end);
    }
  });

  it("skips disabled and empty segments", () => {
    const off = { ...caption("c1", 10, 12, "quiet"), enabled: false };
    const blank = { ...caption("c2", 13, 15, "x"), text: "  " };
    expect(remapCaptionsToOutput([off, blank], segments, hook)).toEqual([]);
  });

  it("clips captions to after the hook window when the hook burns its own", () => {
    const remapped = remapCaptionsToOutput(
      [caption("c1", 2, 4, "inside hook"), caption("c2", 3, 8, "straddles"), caption("c3", 10, 12, "after")],
      segments,
      hook,
      { start: hook.start, end: hook.end }
    );
    expect(remapped).toHaveLength(2);
    // The straddling caption starts where the hook's captions stop.
    expect(remapped[0].start).toBeCloseTo(5, 3);
    expect(remapped[0].end).toBeCloseTo(8, 3);
    expect(remapped[0].words.every((w) => w.start >= 5)).toBe(true);
    expect(remapped[1]).toMatchObject({ start: 10, end: 12 });
  });

  it("keeps body captions before a moved hook window and drops the ones inside it", () => {
    // Hook pulled from 10-15s of the source. Captions before 10s belong to the
    // body (they play after the hook); ones inside the window are the hook's.
    const movedHook = hookWith({ enabled: true, start: 10, end: 15 });
    const remapped = remapCaptionsToOutput(
      [caption("c1", 2, 4, "before"), caption("c2", 11, 13, "inside"), caption("c3", 30, 32, "after")],
      segments,
      movedHook,
      { start: movedHook.start, end: movedHook.end }
    );
    expect(remapped.map((s) => s.text)).toEqual(["before", "after"]);
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

  it("pulls a moved hook window out of the middle and keeps the footage around it", () => {
    // A single kept take, hook sourced from 10-15s. The body is what's left on
    // both sides of the window (before it plays after the hook in the export).
    const take: LongformSegment[] = [{ id: "1", start: 0, end: 30, kind: "speech", enabled: true }];
    const { hookRange, bodyRanges } = exportRanges(take, hookWith({ enabled: true, start: 10, end: 15 }));
    expect(hookRange).toEqual({ start: 10, end: 15 });
    expect(bodyRanges).toEqual([
      { start: 0, end: 10 },
      { start: 15, end: 30 }
    ]);
  });

  it("drops the hook when its window is empty or inverted", () => {
    const take: LongformSegment[] = [{ id: "1", start: 0, end: 30, kind: "speech", enabled: true }];
    const { hookRange, bodyRanges } = exportRanges(take, hookWith({ enabled: true, start: 8, end: 8 }));
    expect(hookRange).toBeNull();
    expect(bodyRanges).toEqual([{ start: 0, end: 30 }]);
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

  it("resolves points around a hook pulled from the middle by source containment", () => {
    // One kept take 0-40, hook sourced from 10-15 → output is hook[10-15] (0-5),
    // then body[0-10] (5-15), then body[15-40] (15-40).
    const take: LongformSegment[] = [{ id: "1", start: 0, end: 40, kind: "speech", enabled: true }];
    const moved = hookWith({ enabled: true, start: 10, end: 15 });
    // A source point inside the hook window maps to the front.
    expect(sourceTimeToOutput(12, take, moved)).toBeCloseTo(2, 3);
    // A source point before the hook window plays after it: src 5 → 5s hook + 5s.
    expect(sourceTimeToOutput(5, take, moved)).toBeCloseTo(10, 3);
    // A source point after the hook window: src 20 → 5 (hook) + 10 (body 0-10) + 5.
    expect(sourceTimeToOutput(20, take, moved)).toBeCloseTo(20, 3);
  });
});

describe("planHook anchoring", () => {
  it("starts the hook at the first spoken word, not at a silent opening", () => {
    // A stream that opens on a title card or music leaves the first seconds
    // untranscribed; anchoring at 0 produced a hook window with no words in
    // it, which is how a fully-transcribed stream exported a caption-less hook.
    const transcript = [
      caption("a", 42, 47, "right so here is the thing nobody tells you"),
      caption("b", 47, 53, "you do not need permission to start building")
    ];
    const hook = planHook(transcript, 600);
    expect(hook.start).toBeCloseTo(42);
    expect(hook.end).toBeGreaterThan(hook.start);
    expect(hook.captions.length).toBeGreaterThan(0);
  });

  it("still anchors at zero when speech starts immediately", () => {
    const hook = planHook([caption("a", 0, 6, "we are live and building today")], 600);
    expect(hook.start).toBe(0);
    expect(hook.captions.length).toBeGreaterThan(0);
  });

  it("keeps the punch-in gentle enough not to crop a screen share", () => {
    const hook = planHook([], 600);
    expect(hook.zoom).toBeLessThanOrEqual(1.15);
  });

  it("gives every new project the 30-second captioned, moving opening", () => {
    const transcript = [
      caption("a", 0, 15, "here is what nobody tells you about building in public every day"),
      caption("b", 15, 32, "you do not need permission and you do not need an audience to start")
    ];
    const hook = planHook(transcript, 900);
    expect(hook.end - hook.start).toBeGreaterThanOrEqual(24);
    expect(hook.captionsEnabled).toBe(true);
    expect(hook.motionEnabled).toBe(true);
    // Captions cover the block, not just its first seconds.
    expect(Math.max(...hook.captions.map((seg) => seg.end))).toBeGreaterThan(20);
  });
});

describe("resolvePace", () => {
  it("fills the detection floor for projects saved before the pace carried one", () => {
    const legacy = resolvePace({ minSilenceSec: 0.7, paddingSec: 0.15 });
    expect(legacy.minSilenceSec).toBe(0.7);
    expect(legacy.noiseDb).toBe(DEFAULT_PACE.noiseDb);
    expect(legacy.detectMinSec).toBe(DEFAULT_PACE.detectMinSec);
    expect(legacy.maxKeptGapSec).toBeGreaterThan(0);
  });

  it("hands each preset its own detection floor, tightening with the pace", () => {
    const [relaxed, fast, ultra] = PACE_PRESETS.map((preset) => resolvePace(preset.pace));
    expect(relaxed.noiseDb).toBeLessThan(fast.noiseDb);
    expect(fast.noiseDb).toBeLessThan(ultra.noiseDb);
    expect(relaxed.detectMinSec).toBeGreaterThan(ultra.detectMinSec);
    // Detection must always reach the shortest pause the pace can act on.
    for (const pace of [relaxed, fast, ultra]) {
      expect(paceDetection(pace).minDurSec).toBeLessThanOrEqual(pace.maxKeptGapSec + 0.12);
      expect(paceDetection(pace).minDurSec).toBeLessThanOrEqual(pace.minSilenceSec);
    }
  });
});
