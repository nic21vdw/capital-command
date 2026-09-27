import { describe, expect, it } from "vitest";
import { cleanInPoint, isFillerWord, planFillerCuts } from "@/lib/longform/fillers";
import { ensureStoryArc, guessRole, repairContinuity, trimBlankEdges } from "@/lib/longform/highlights";
import { remapCaptionsToOutput } from "@/lib/longform/plan";
import type { LongformHook, LongformSegment } from "@/lib/longform/types";
import { buildVisionPrompt, contactSheetTimes, parseVisionReview } from "@/lib/longform/vision-review";
import { cutDifference, passageVisuals, samplesFromFrames, signatureDifference, visualHint } from "@/lib/longform/visual-scan";
import { planZoomCuts, zoomCutFilter } from "@/lib/longform/zoom-cuts";
import type { CaptionSegment } from "@/types/domain";

/** A caption segment from [text, start, end] words. */
function spoken(words: Array<[string, number, number]>): CaptionSegment {
  return {
    id: `cap-${words[0][1]}`,
    start: words[0][1],
    end: words[words.length - 1][2],
    text: words.map(([text]) => text).join(" "),
    enabled: true,
    words: words.map(([text, start, end]) => ({ text, start, end }))
  };
}

function frame(value: number | ((index: number) => number)): Uint8Array {
  return Uint8Array.from({ length: 64 * 36 }, (_, index) => (typeof value === "number" ? value : value(index)));
}

describe("filler cuts", () => {
  const transcript = [
    spoken([
      ["So", 0, 0.3],
      ["the", 0.4, 0.55],
      ["um", 0.7, 1.1],
      ["build", 1.3, 1.6],
      ["is", 1.65, 1.8],
      ["is", 1.85, 2.0],
      ["green", 2.05, 2.4],
      ["now.", 3.4, 3.7]
    ])
  ];

  it("cuts the filler, the first half of a stutter and a long gap, and nothing else", () => {
    const cuts = planFillerCuts(transcript, [{ start: 0, end: 4 }]);
    expect(cuts.map((cut) => cut.reason)).toEqual(["filler", "stutter", "gap"]);
    // The filler cut sits between "the" and "build" with air kept on both sides.
    expect(cuts[0].start).toBeCloseTo(0.67, 3);
    expect(cuts[0].end).toBeCloseTo(1.27, 3);
    // No cut ever overlaps a kept word.
    const kept = transcript[0].words.filter((word, index) => !["um"].includes(word.text) && index !== 4);
    for (const cut of cuts) {
      for (const word of kept) expect(cut.end <= word.start || cut.start >= word.end).toBe(true);
    }
  });

  it("recognises fillers but leaves words that carry meaning", () => {
    expect(isFillerWord("Um,")).toBe(true);
    expect(isFillerWord("uhh")).toBe(true);
    expect(isFillerWord("like")).toBe(false);
    expect(isFillerWord("so")).toBe(false);
  });

  it("starts a passage on its first real word", () => {
    expect(cleanInPoint(transcript, { start: 0, end: 4 })).toBeCloseTo(0.32, 3);
    const clean = [spoken([["Deploying", 5, 5.5], ["now.", 5.6, 5.9]])];
    expect(cleanInPoint(clean, { start: 5, end: 6 })).toBe(5);
  });
});

describe("the visual scan", () => {
  it("reads a blank card, a change of shot and a static screen", () => {
    const frames = [frame(0), frame(0), frame((i) => (i * 7) % 256), frame((i) => (i * 7) % 256), frame((i) => (i * 7) % 256)];
    const samples = samplesFromFrames(frames, [0, 2, 4, 6, 8]);
    expect(samples[0].spread).toBeLessThan(1);
    expect(samples[2].diff).toBeGreaterThan(28);
    const blank = passageVisuals(samples, 0, 3);
    expect(blank.blankRatio).toBe(1);
    const busy = passageVisuals(samples, 4, 8);
    expect(busy.blankRatio).toBe(0);
    expect(busy.frozenRatio).toBe(1);
    expect(visualHint(blank)).toContain("blank");
  });

  it("tells a jump cut in the same shot from a cut to new material", () => {
    const frames = [frame((i) => (i * 7) % 256), frame((i) => (i * 7 + 2) % 256), frame(10), frame(10)];
    const samples = samplesFromFrames(frames, [0, 2, 4, 6]);
    expect(cutDifference(samples, 0, 2)!).toBeLessThan(28);
    expect(cutDifference(samples, 2, 4)!).toBeGreaterThan(28);
    expect(signatureDifference(samples[2].sig, samples[3].sig)).toBe(0);
  });
});

describe("blank edges", () => {
  it("starts a passage on the first sentence with a picture, never on the tail of a blank card", () => {
    const blank = frame(0);
    const busy = frame((i) => (i * 7) % 256);
    const samples = samplesFromFrames([blank, blank, blank, busy, busy, busy, busy, blank], [114, 116, 118, 120, 150, 180, 210, 224]);
    const sentences = [
      { start: 114, end: 119 },
      { start: 120, end: 125 },
      { start: 200, end: 212 },
      { start: 214, end: 225 }
    ];
    expect(trimBlankEdges({ start: 114, end: 225 }, samples, sentences, 40)).toEqual({ start: 120, end: 212 });
    // A trim that would leave too little is not made.
    expect(trimBlankEdges({ start: 114, end: 225 }, samples, sentences, 100)).toEqual({ start: 114, end: 225 });
  });
});

describe("the vision review", () => {
  it("takes six frames just inside the passage", () => {
    const times = contactSheetTimes(100, 200);
    expect(times).toHaveLength(6);
    expect(times[0]).toBeGreaterThan(100);
    expect(times[5]).toBeLessThan(200);
  });

  it("asks about the picture against the words and the story", () => {
    const prompt = buildVisionPrompt({ premise: "Shipping an agent", role: "problem", words: "Look at this error.", times: [1, 2, 3, 4, 5, 6] });
    expect(prompt).toContain("Shipping an agent");
    expect(prompt).toContain("Look at this error.");
    expect(prompt).toContain("VERDICT:");
  });

  it("parses a verdict, and never keeps a sensitive screen", () => {
    const keep = parseVisionReview("SEE: VS Code with a failing test\nMATCH: yes\nCONTEXT: none\nPROBLEM: none\nVERDICT: keep\nSCORE: 8");
    expect(keep).toEqual({ verdict: "keep", score: 8, see: "VS Code with a failing test", context: "", problem: "none" });
    const leak = parseVisionReview("SEE: .env file open\nMATCH: yes\nCONTEXT: none\nPROBLEM: sensitive\nVERDICT: keep\nSCORE: 7");
    expect(leak?.verdict).toBe("drop");
    expect(parseVisionReview("I think it looks fine")).toBeNull();
  });
});

describe("zoom cuts", () => {
  it("alternates the framing on jump cuts once a framing has been held", () => {
    const zoomed = planZoomCuts([
      { start: 0, end: 4 },
      { start: 4.5, end: 9 },
      { start: 9.3, end: 10 },
      { start: 10.2, end: 15 }
    ]);
    // 0-4 wide, 4-8.5 punched in, then wide again; the cut at 9.2 comes too
    // soon after that flip to flip again, so the rest stays wide.
    expect(zoomed).toEqual([{ start: 4, end: 8.5 }]);
  });

  it("cuts straight back to wide on new material", () => {
    const zoomed = planZoomCuts([
      { start: 0, end: 4 },
      { start: 4.5, end: 9 },
      { start: 300, end: 305 }
    ]);
    expect(zoomed).toEqual([{ start: 4, end: 8.5 }]);
  });

  it("renders as one zoompan over a 1:1 punch-in", () => {
    const filter = zoomCutFilter({ zoomed: [{ start: 4, end: 8.5 }], width: 1920, height: 1080, fps: 30, focusX: 0.5, focusY: 0.45 });
    expect(filter).toContain("scale=2150:1210");
    expect(filter).toContain("between(it,4.000,8.499)");
    expect(filter).toContain("s=1920x1080:fps=30");
  });
});

describe("the story", () => {
  const planned = [
    { start: 0, end: 100, text: "Hey chat, getting set up.", score: 30 },
    { start: 100, end: 200, text: "Today the goal is to ship the booking agent.", score: 40 },
    { start: 200, end: 300, text: "Writing the scheduler logic.", score: 70 },
    { start: 300, end: 400, text: "The build failed with a type error.", score: 75 },
    { start: 400, end: 500, text: "Fixed the types and moved on.", score: 72 },
    { start: 500, end: 600, text: "Reading chat for a bit.", score: 20 },
    { start: 600, end: 700, text: "Finally it works, the agent booked a visit.", score: 45 }
  ];
  // Each passage runs 200 seconds once cut, so the arc is judged at a real length.
  const runtimes = planned.map((passage) => (passage.end - passage.start) * 2);

  it("opens on the goal and ends on the payoff even when they scored low", () => {
    const { chosen, pinned } = ensureStoryArc(planned, runtimes, new Set([2, 3, 4]), 800);
    expect([...pinned].sort()).toEqual([1, 6]);
    expect([...chosen].sort()).toEqual([1, 3, 4, 6]);
  });

  it("never trims the story under the eight-minute floor to fit its ends", () => {
    const { chosen } = ensureStoryArc(planned, runtimes.map(() => 130), new Set([2, 3]), 480);
    expect([...chosen].reduce((sum) => sum + 130, 0)).toBeGreaterThanOrEqual(480);
  });

  it("names each passage's job", () => {
    expect(guessRole(planned[1].text, 0.1)).toBe("setup");
    expect(guessRole(planned[3].text, 0.5)).toBe("problem");
    expect(guessRole(planned[6].text, 0.9)).toBe("payoff");
  });

  it("bridges a passage that points back at something the edit skipped", () => {
    const passages = [
      { start: 0, end: 60, text: "The login page throws on submit." },
      { start: 62, end: 160, text: "Like I said, the login page still throws." },
      { start: 165, end: 390, text: "A long stretch about the database schema." },
      { start: 392, end: 500, text: "That's why we rewrote the auth flow." }
    ];
    const result = repairContinuity(passages, [60, 98, 225, 108], new Set([1, 3]));
    // The first is bridged by the short passage right before it; the second
    // points back at a long one, so it goes.
    expect([...result.bridges]).toEqual([0]);
    expect([...result.dropped]).toEqual([3]);
    expect([...result.chosen].sort()).toEqual([0, 1]);
  });
});

describe("captions over cut words", () => {
  it("drops a word the edit removed and rewrites the caption without it", () => {
    const segments: LongformSegment[] = [
      { id: "seg-1", start: 0, end: 0.65, kind: "speech", enabled: true },
      { id: "seg-2", start: 0.65, end: 1.22, kind: "speech", enabled: false },
      { id: "seg-3", start: 1.22, end: 4, kind: "speech", enabled: true }
    ];
    const hook = { enabled: false, start: 0, end: 0 } as LongformHook;
    const caption = spoken([
      ["the", 0.4, 0.55],
      ["um", 0.7, 1.1],
      ["build", 1.3, 1.6]
    ]);
    const [out] = remapCaptionsToOutput([caption], segments, hook);
    expect(out.text).toBe("the build");
    expect(out.words.map((word) => word.text)).toEqual(["the", "build"]);
  });
});
