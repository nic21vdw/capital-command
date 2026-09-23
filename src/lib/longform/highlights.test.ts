import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionSegment } from "@/types/domain";
import type { LongformHook, LongformSegment } from "@/lib/longform/types";

const ai = vi.hoisted(() => ({ configured: false, reply: "" as string | null }));

vi.mock("@/lib/ai", () => ({
  aiConfigured: () => ai.configured,
  runAi: async () => (ai.reply === null ? null : { text: ai.reply, refused: false })
}));

import {
  applyHighlight,
  buildHighlight,
  buildHighlightPrompt,
  buildPassageWindows,
  highlightChapters,
  highlightRuntimeSec,
  keptSecondsIn,
  parseHighlightDecision,
  pickColdOpen,
  planPassages,
  restrictSegments,
  selectPassages
} from "@/lib/longform/highlights";
import { editedDurationSec, extendCaptionSegments, planHook } from "@/lib/longform/plan";
import { fallbackLongformMetadata, fixedChapters } from "@/lib/longform/metadata";

function caption(start: number, end: number, text: string): CaptionSegment {
  const words = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, words.length);
  return {
    id: `cap-${start}`,
    start,
    end,
    text,
    enabled: true,
    words: words.map((word, index) => ({ text: word, start: start + index * step, end: start + (index + 1) * step }))
  };
}

const HOT_START = 60 * 60;
const HOT_END = 80 * 60;
const COLD_OPEN_LINE = "Why does nobody tell you the biggest mistake with AI agents is trusting the first answer?";
const COLD_OPEN_AT = 70 * 60;

/**
 * A two-hour stream, one line every five seconds. Most of it is ordinary
 * build talk; the first ten minutes are the stream waiting on itself (slow,
 * filler), and minutes 60-80 are the stretch worth watching: fast, emphatic,
 * on the channel's subjects, with one line that would stop a scroll.
 */
function streamTranscript(): CaptionSegment[] {
  const lines: CaptionSegment[] = [];
  for (let at = 0; at < 2 * 60 * 60; at += 5) {
    let text: string;
    if (at < 10 * 60) text = "Um yeah okay so.";
    else if (at === COLD_OPEN_AT) text = COLD_OPEN_LINE;
    else if (at >= HOT_START && at < HOT_END) {
      text = "This is insane, the AI agent actually shipped the whole SaaS feature in one pass with Claude!";
    } else {
      text = "I am wiring the settings page to the database and checking the form validation next.";
    }
    lines.push(caption(at, at + 4.5, text));
  }
  return lines;
}

function wholeSegments(durationSec: number): LongformSegment[] {
  return [{ id: "seg-1", start: 0, end: durationSec, kind: "speech", enabled: true }];
}

function baseHook(transcript: CaptionSegment[]): LongformHook {
  return planHook(transcript, 2 * 60 * 60);
}

beforeEach(() => {
  ai.configured = false;
  ai.reply = "";
});

describe("buildPassageWindows", () => {
  it("groups the stream into passages that end on a sentence and fit the length band", () => {
    const windows = buildPassageWindows(streamTranscript());
    expect(windows.length).toBeGreaterThan(40);
    for (const window of windows) {
      const length = window.end - window.start;
      expect(length).toBeGreaterThanOrEqual(40);
      expect(length).toBeLessThanOrEqual(240 * 1.25);
    }
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index].start).toBeGreaterThanOrEqual(windows[index - 1].end);
    }
  });

  it("never runs a passage across a dead stretch", () => {
    const transcript = [
      ...Array.from({ length: 20 }, (_, i) => caption(i * 5, i * 5 + 4.5, "The first part of the build is the login screen today.")),
      ...Array.from({ length: 20 }, (_, i) => caption(300 + i * 5, 300 + i * 5 + 4.5, "The second part of the build is the billing page today."))
    ];
    const windows = buildPassageWindows(transcript);
    expect(windows.some((window) => window.start < 100 && window.end > 300)).toBe(false);
  });
});

describe("selectPassages", () => {
  it("fills the target runtime without running more than a tenth over", () => {
    const transcript = streamTranscript();
    const passages = planPassages(transcript);
    const runtimes = passages.map((passage) => passage.end - passage.start);
    const chosen = selectPassages(passages, runtimes, 20 * 60);
    const runtime = [...chosen].reduce((sum, index) => sum + runtimes[index], 0);
    expect(runtime).toBeGreaterThan(20 * 60 * 0.85);
    expect(runtime).toBeLessThanOrEqual(20 * 60 * 1.1);
  });

  it("prefers the stretch worth watching and drops the stream waiting on itself", () => {
    const transcript = streamTranscript();
    const passages = planPassages(transcript);
    const runtimes = passages.map((passage) => passage.end - passage.start);
    const chosen = [...selectPassages(passages, runtimes, 20 * 60)].map((index) => passages[index]);
    const inHot = chosen.filter((passage) => passage.start >= HOT_START - 5 && passage.end <= HOT_END + 5);
    expect(inHot.length / chosen.length).toBeGreaterThan(0.8);
    expect(chosen.some((passage) => passage.start < 10 * 60)).toBe(false);
  });

  it("keeps everything when the stream has less good material than the target", () => {
    const passages = [
      { start: 0, end: 100, score: 60 },
      { start: 100, end: 200, score: 50 }
    ];
    expect([...selectPassages(passages, [100, 100], 20 * 60)].sort()).toEqual([0, 1]);
  });
});

describe("restrictSegments", () => {
  it("cuts everything outside the windows and keeps the dead-space cuts inside them", () => {
    const segments: LongformSegment[] = [
      { id: "seg-1", start: 0, end: 50, kind: "speech", enabled: true },
      { id: "seg-2", start: 50, end: 52, kind: "silence", enabled: false },
      { id: "seg-3", start: 52, end: 200, kind: "speech", enabled: true }
    ];
    const restricted = restrictSegments(segments, [{ start: 40, end: 100 }]);
    expect(keptSecondsIn(restricted, 0, 200)).toBeCloseTo(58, 3);
    expect(restricted.find((segment) => segment.start === 50)?.enabled).toBe(false);
    expect(restricted.filter((segment) => segment.enabled).every((segment) => segment.start >= 40 && segment.end <= 100)).toBe(true);
    // Still tiles the recording, so the timeline shows the cut footage.
    expect(restricted[0].start).toBe(0);
    expect(restricted[restricted.length - 1].end).toBe(200);
  });
});

describe("pickColdOpen", () => {
  it("lifts the strongest line in the edit and extends it to a proper beat", () => {
    const transcript = streamTranscript();
    const coldOpen = pickColdOpen(transcript, [{ start: 30 * 60, end: 31 * 60 }, { start: 69 * 60, end: 72 * 60 }]);
    expect(coldOpen?.start).toBe(COLD_OPEN_AT);
    expect(coldOpen!.text.startsWith(COLD_OPEN_LINE)).toBe(true);
    expect(coldOpen!.end - coldOpen!.start).toBeGreaterThanOrEqual(8);
    expect(coldOpen!.end - coldOpen!.start).toBeLessThanOrEqual(20);
  });

  it("keeps the natural opening when nothing beats it", () => {
    const transcript = streamTranscript();
    expect(pickColdOpen(transcript, [{ start: 20 * 60, end: 25 * 60 }])).toBeUndefined();
  });
});

describe("buildHighlight", () => {
  it("cuts a two-hour stream down to about the target and opens on the cold open (offline)", async () => {
    const transcript = streamTranscript();
    const built = await buildHighlight({
      streamName: "Building an AI agent live",
      transcript,
      baseSegments: wholeSegments(7200),
      baseHook: baseHook(transcript)
    });
    expect(built).not.toBeNull();
    const { highlight, segments, hook } = built!;
    expect(highlight.selectedBy).toBe("fallback");
    const runtime = editedDurationSec(segments, hook);
    expect(runtime).toBeGreaterThan(17 * 60);
    expect(runtime).toBeLessThan(23 * 60);
    expect(highlight.opening).toBe("cold-open");
    expect(hook.start).toBe(COLD_OPEN_AT);
    expect(hook.captions.length).toBeGreaterThan(0);
    expect(highlightRuntimeSec(highlight, segments)).toBeGreaterThan(17 * 60);
  });

  it("uses the editor pass when its pick is about the length asked for", async () => {
    const transcript = streamTranscript();
    const passages = planPassages(transcript);
    // Keep a contiguous run of passages from the middle of the stream worth ~20 minutes.
    const keep: string[] = [];
    let total = 0;
    passages.forEach((passage, index) => {
      if (passage.start >= 30 * 60 && total < 20 * 60) {
        keep.push(`p${index + 1}`);
        total += passage.end - passage.start;
      }
    });
    ai.configured = true;
    ai.reply = JSON.stringify({ keep, coldOpen: keep[2], labels: { [keep[0]]: "Settings Page Wiring" } });
    const built = await buildHighlight({
      streamName: "Stream",
      transcript,
      baseSegments: wholeSegments(7200),
      baseHook: baseHook(transcript)
    });
    expect(built!.highlight.selectedBy).toBe("ai");
    const enabled = built!.highlight.passages.filter((passage) => passage.enabled).map((passage) => passage.id);
    expect(enabled).toEqual(keep);
    expect(built!.highlight.passages.find((passage) => passage.id === keep[0])?.label).toBe("Settings Page Wiring");
  });

  it("falls back to the scorer when the editor pass keeps far too much", async () => {
    const transcript = streamTranscript();
    const passages = planPassages(transcript);
    ai.configured = true;
    ai.reply = JSON.stringify({ keep: passages.map((_, index) => `p${index + 1}`), labels: {} });
    const built = await buildHighlight({
      streamName: "Stream",
      transcript,
      baseSegments: wholeSegments(7200),
      baseHook: baseHook(transcript)
    });
    expect(built!.highlight.selectedBy).toBe("fallback");
  });
});

describe("applyHighlight", () => {
  it("re-picks the cold open when its passage is swapped out", async () => {
    const transcript = streamTranscript();
    const built = await buildHighlight({
      streamName: "Stream",
      transcript,
      baseSegments: wholeSegments(7200),
      baseHook: baseHook(transcript)
    });
    const passages = built!.highlight.passages.map((passage) =>
      passage.start <= COLD_OPEN_AT && passage.end >= COLD_OPEN_AT ? { ...passage, enabled: false } : passage
    );
    const applied = applyHighlight({
      highlight: { ...built!.highlight, passages },
      baseSegments: wholeSegments(7200),
      baseHook: built!.hook,
      transcript
    });
    expect(applied.hook.start).not.toBe(COLD_OPEN_AT);
    const kept = passages.filter((passage) => passage.enabled);
    expect(kept.some((passage) => applied.hook.start >= passage.start && applied.hook.end <= passage.end)).toBe(true);
  });
});

describe("highlightChapters", () => {
  const hook: LongformHook = { ...baseHook([]), enabled: true, start: 0, end: 10, captions: [] };

  it("starts at 0:00 and follows YouTube's rules", () => {
    const passages = [
      { start: 0, end: 120, label: "Intro and Goal", enabled: true },
      { start: 600, end: 720, label: "Database Setup", enabled: true },
      { start: 1200, end: 1320, label: "First Deploy", enabled: true },
      { start: 1800, end: 1920, label: "Unused", enabled: false }
    ];
    const segments = restrictSegments(wholeSegments(2000), passages.filter((p) => p.enabled));
    const chapters = highlightChapters(passages, segments, hook);
    expect(chapters.map((chapter) => chapter.time)).toEqual(["0:00", "2:00", "4:00"]);
    expect(chapters.map((chapter) => chapter.label)).toEqual(["Intro and Goal", "Database Setup", "First Deploy"]);
  });

  it("merges passages that share a label or land too close together", () => {
    const passages = [
      { start: 0, end: 120, label: "Intro", enabled: true },
      { start: 120, end: 240, label: "Intro", enabled: true },
      { start: 240, end: 280, label: "Tiny Aside", enabled: true },
      { start: 280, end: 400, label: "Billing", enabled: true },
      { start: 400, end: 520, label: "Launch", enabled: true }
    ];
    const chapters = highlightChapters(passages, wholeSegments(600), hook);
    expect(chapters.map((chapter) => chapter.label)).toEqual(["Intro", "Billing", "Launch"]);
    expect(chapters.map((chapter) => chapter.time)).toEqual(["0:00", "4:40", "6:40"]);
  });

  it("returns nothing rather than a list YouTube would ignore", () => {
    const passages = [
      { start: 0, end: 120, label: "One", enabled: true },
      { start: 120, end: 240, label: "Two", enabled: true }
    ];
    expect(highlightChapters(passages, wholeSegments(240), hook)).toEqual([]);
  });
});

describe("the editor pass", () => {
  it("lists every passage with its runtime and the target", () => {
    const prompt = buildHighlightPrompt({
      streamName: "Stream",
      targetSec: 1200,
      passages: [{ id: "p1", at: "1:00", runtimeSec: 95, score: 70, text: "We set the goal for today." }]
    });
    expect(prompt).toContain("about 20 minutes");
    expect(prompt).toContain("[p1] at 1:00, 95s, score 70: We set the goal for today.");
  });

  it("drops ids it never sent and labels that are not labels", () => {
    const decision = parseHighlightDecision(
      '```json\n{"keep": ["p1", "p9", "p2"], "coldOpen": "p9", "labels": {"p1": "Goal Setting", "p2": "' +
        "x".repeat(80) +
        '"}}\n```',
      new Set(["p1", "p2"])
    );
    expect(decision?.keep).toEqual(["p1", "p2"]);
    expect(decision?.coldOpen).toBeUndefined();
    expect(decision?.labels.get("p1")).toBe("Goal Setting");
    expect(decision?.labels.has("p2")).toBe(false);
  });
});

describe("metadata for a best-of edit", () => {
  it("carries the edit's own chapters into the description", () => {
    const passages = [
      { id: "p1", start: 0, end: 120, label: "Goal", enabled: true },
      { id: "p2", start: 600, end: 720, label: "Build", enabled: true },
      { id: "p3", start: 1200, end: 1320, label: "Ship", enabled: true }
    ].map((passage) => ({ ...passage, score: 60, labelSource: "ai" as const, keywords: [], opening: "", picked: true }));
    const hook: LongformHook = { ...baseHook([]), enabled: true, start: 0, end: 10, captions: [] };
    const project = {
      name: "Stream",
      highlight: { targetSec: 1200, passages, opening: "natural" as const, selectedBy: "ai" as const, builtAt: "" },
      segments: restrictSegments(wholeSegments(2000), passages),
      hook
    };
    expect(fixedChapters(project).map((chapter) => `${chapter.time} ${chapter.label}`)).toEqual([
      "0:00 Goal",
      "2:00 Build",
      "4:00 Ship"
    ]);
    expect(fallbackLongformMetadata(project).description).toContain("Chapters:\n0:00 Goal\n2:00 Build\n4:00 Ship");
  });
});

describe("extendCaptionSegments", () => {
  it("keeps the stored captions and carries on from the whole-stream transcript", () => {
    const stored = [{ ...caption(0, 4, "edited by hand here"), id: "cap-1" }];
    const full = [caption(0, 4, "original words were here"), caption(10, 14, "later words from the stream")];
    const extended = extendCaptionSegments(stored, full);
    expect(extended[0].text).toBe("edited by hand here");
    expect(extended.some((segment) => segment.text.includes("later words"))).toBe(true);
    expect(extended.some((segment) => segment.text.includes("original"))).toBe(false);
  });
});
