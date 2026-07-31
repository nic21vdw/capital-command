import { describe, expect, it } from "vitest";
import {
  MAX_RECUT_SEC,
  clampRange,
  contextWindow,
  formatTimecode,
  packLanes,
  parseTimecode,
  rangesWithin,
  rulerStep,
  rulerTicks,
  snapToSpeech,
  spokenAround
} from "@/lib/clipping/timeline";
import type { CaptionSegment } from "@/types/domain";

const captions: CaptionSegment[] = [
  {
    id: "cap-1",
    start: 100,
    end: 103,
    text: "the whole point of this",
    enabled: true,
    words: [
      { text: "the", start: 100, end: 100.4 },
      { text: "whole", start: 100.5, end: 101 },
      { text: "point", start: 101.2, end: 101.8 },
      { text: "of", start: 102, end: 102.2 },
      { text: "this", start: 102.4, end: 103 }
    ]
  },
  {
    id: "cap-2",
    start: 104,
    end: 106,
    text: "is leverage",
    enabled: true,
    words: [
      { text: "is", start: 104, end: 104.5 },
      { text: "leverage", start: 104.8, end: 106 }
    ]
  }
];

describe("ruler", () => {
  it("picks a round interval that fits the target tick count", () => {
    expect(rulerStep(60, 6)).toBe(10);
    expect(rulerStep(7200, 8)).toBe(900);
    expect(rulerStep(4, 8)).toBe(1);
  });

  it("lays ticks on multiples of the step inside the span", () => {
    expect(rulerTicks(95, 130, 10)).toEqual([100, 110, 120, 130]);
  });
});

describe("packLanes", () => {
  it("keeps disjoint ranges on one lane", () => {
    expect(packLanes([{ start: 0, end: 10 }, { start: 20, end: 30 }])).toEqual([0, 0]);
  });

  it("pushes overlapping ranges onto their own lanes", () => {
    expect(
      packLanes([
        { start: 0, end: 30 },
        { start: 10, end: 40 },
        { start: 20, end: 50 }
      ])
    ).toEqual([0, 1, 2]);
  });

  it("separates ranges that only collide once drawn at a minimum width", () => {
    // Two 20s clips 30s apart don't overlap in time, but on a 3h bar they are
    // the same handful of pixels — minSpanSec is what keeps them readable.
    const lanes = packLanes([{ start: 0, end: 20 }, { start: 30, end: 50 }], 120);
    expect(lanes).toEqual([0, 1]);
  });

  it("returns lanes positionally even when the input is out of order", () => {
    expect(packLanes([{ start: 60, end: 90 }, { start: 0, end: 30 }])).toEqual([0, 0]);
  });
});

describe("clampRange", () => {
  const durationSec = 3600;

  it("holds the end still while the start handle moves", () => {
    expect(clampRange({ start: 40, end: 120 }, { durationSec, anchor: "end" })).toEqual({ start: 40, end: 120 });
  });

  it("stops a start handle dragged past the end instead of shoving the end along", () => {
    expect(clampRange({ start: 200, end: 120 }, { durationSec, anchor: "end", minSec: 3 })).toEqual({
      start: 117,
      end: 120
    });
  });

  it("stops an end handle dragged past the start", () => {
    expect(clampRange({ start: 100, end: 20 }, { durationSec, anchor: "start", minSec: 3 })).toEqual({
      start: 100,
      end: 103
    });
  });

  it("never runs past either end of the source", () => {
    expect(clampRange({ start: -30, end: 40 }, { durationSec, anchor: "end" }).start).toBe(0);
    expect(clampRange({ start: 3550, end: 4000 }, { durationSec, anchor: "start" }).end).toBe(3600);
  });

  it("caps the length at the maximum, trimming the edge that is moving", () => {
    expect(clampRange({ start: 0, end: 5000 }, { durationSec: 10000, anchor: "start" }).end).toBe(MAX_RECUT_SEC);
    expect(clampRange({ start: 0, end: 5000 }, { durationSec: 10000, anchor: "end" }).start).toBe(
      5000 - MAX_RECUT_SEC
    );
  });

  it("copes with a source shorter than the minimum clip", () => {
    const range = clampRange({ start: 0, end: 10 }, { durationSec: 2, minSec: 3 });
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThanOrEqual(3);
  });
});

describe("contextWindow", () => {
  it("pads a clip on both sides", () => {
    expect(contextWindow({ start: 300, end: 322 }, { durationSec: 3600, paddingSec: 60 })).toEqual({
      start: 240,
      end: 382
    });
  });

  it("keeps its full width against the start of the stream", () => {
    expect(contextWindow({ start: 5, end: 27 }, { durationSec: 3600, paddingSec: 60 })).toEqual({
      start: 0,
      end: 142
    });
  });

  it("keeps its full width against the end of the stream", () => {
    const window = contextWindow({ start: 3570, end: 3592 }, { durationSec: 3600, paddingSec: 60 });
    expect(window.end).toBe(3600);
    expect(window.end - window.start).toBe(142);
  });

  it("never asks for more than the stream has", () => {
    expect(contextWindow({ start: 10, end: 40 }, { durationSec: 50, paddingSec: 600 })).toEqual({
      start: 0,
      end: 50
    });
  });
});

describe("rangesWithin", () => {
  it("keeps only the overlapping part of each range", () => {
    expect(
      rangesWithin([{ start: 0, end: 50 }, { start: 90, end: 95 }, { start: 200, end: 260 }], 40, 210)
    ).toEqual([
      { start: 40, end: 50 },
      { start: 90, end: 95 },
      { start: 200, end: 210 }
    ]);
  });
});

describe("spokenAround", () => {
  it("flags which words the current in/out points actually include", () => {
    const words = spokenAround(captions, { start: 101, end: 104.6 }, { start: 95, end: 110 });
    expect(words.map((word) => word.text)).toEqual(["the", "whole", "point", "of", "this", "is", "leverage"]);
    // "whole" ends exactly on the in point, so the cut lands after it.
    expect(words.filter((word) => word.inside).map((word) => word.text)).toEqual(["point", "of", "this", "is"]);
  });

  it("drops words outside the visible window", () => {
    expect(spokenAround(captions, { start: 104, end: 106 }, { start: 103.5, end: 110 }).map((w) => w.text)).toEqual(
      ["is", "leverage"]
    );
  });
});

describe("snapToSpeech", () => {
  it("snaps an in point onto the start of the nearest word", () => {
    expect(snapToSpeech(101.3, captions, "start")).toBe(101.2);
  });

  it("snaps an out point onto the end of the nearest word", () => {
    expect(snapToSpeech(103.2, captions, "end")).toBe(103);
  });

  it("leaves a cut alone when nothing is spoken nearby", () => {
    expect(snapToSpeech(400, captions, "start")).toBeNull();
  });
});

describe("timecodes", () => {
  it("formats with an hour field only when there is one", () => {
    expect(formatTimecode(75)).toBe("1:15");
    expect(formatTimecode(3725)).toBe("1:02:05");
  });

  it("round-trips what it formats", () => {
    expect(parseTimecode("1:02:05")).toBe(3725);
    expect(parseTimecode("1:15")).toBe(75);
    expect(parseTimecode("90")).toBe(90);
  });

  it("rejects anything that isn't a timecode", () => {
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
    expect(parseTimecode("")).toBeNull();
  });
});
