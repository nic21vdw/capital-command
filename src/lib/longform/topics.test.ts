import { describe, expect, it } from "vitest";
import { projectForTopic, topicDurationSec } from "@/lib/longform/plan";
import {
  boundaryCandidates,
  buildTopicBlocks,
  buildTopicSegmentPrompt,
  contentTerms,
  fallbackTopicTitle,
  parseTopicSegments,
  planTopicSegments,
  termSimilarity
} from "@/lib/longform/topics";
import type { LongformProject, LongformTopic } from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

function caption(start: number, end: number, text: string): CaptionSegment {
  const words = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, words.length);
  return {
    id: `cap-${start}`,
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

/**
 * A synthetic stream: three subjects, each ~10 minutes, each with its own
 * vocabulary. Every line ends a sentence so thought-end snapping has somewhere
 * to land.
 */
const SUBJECT_LINES = [
  [
    "The hackathon build is running and the submission deadline drives every decision today.",
    "Our hackathon demo needs the submission video recorded before the deadline tonight."
  ],
  [
    "The pricing page conversion rate decides how much revenue each visitor is worth.",
    "Revenue per visitor tells us whether the pricing tiers convert or scare people away."
  ],
  [
    "Steel connection checks in the structural workspace still fail on eccentric bolt groups.",
    "The bolt group geometry drives those structural checks more than the steel grade does."
  ]
];

/** Lays the given subjects out back to back, `lines` lines of 15 seconds each. */
function transcriptFor(order: number[], lines: number): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  let time = 0;
  for (const subject of order) {
    for (let line = 0; line < lines; line += 1) {
      segments.push(caption(time, time + 14, SUBJECT_LINES[subject][line % 2]));
      time += 15;
    }
  }
  return segments;
}

/** A word only one of the fixture's subjects ever says. */
const SUBJECT_MARKERS = ["hackathon", "pricing", "bolt"];

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

/** Which fixture subject a segment is mostly about. */
function dominantSubject(text: string): string {
  return SUBJECT_MARKERS.reduce((best, marker) =>
    markerCount(text, marker) > markerCount(text, best) ? marker : best
  );
}

/** A stream that covers its three subjects once each, in order, ~10 minutes apiece. */
function streamTranscript(): CaptionSegment[] {
  return transcriptFor([0, 1, 2], 40);
}

/**
 * The real shape of a stream: the creator drops a subject and picks it up again
 * later, so every subject is spread over two stretches five minutes long that
 * sit in different halves of the recording.
 */
function interleavedTranscript(): CaptionSegment[] {
  return transcriptFor([0, 1, 2, 1, 0, 2], 20);
}

describe("contentTerms", () => {
  it("keeps subject words and drops filler", () => {
    expect(contentTerms("So basically the hackathon deadline is really close!")).toEqual(["hackathon", "deadline", "close"]);
  });
});

describe("termSimilarity", () => {
  it("scores identical vocabularies at 1 and disjoint ones at 0", () => {
    const a = new Map([["hackathon", 3], ["deadline", 1]]);
    const b = new Map([["pricing", 2], ["revenue", 1]]);
    expect(termSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(termSimilarity(a, b)).toBe(0);
  });
});

describe("planTopicSegments", () => {
  const transcript = streamTranscript();

  it("splits a stream into 3-5 topic segments", () => {
    const topics = planTopicSegments(transcript);
    expect(topics.length).toBeGreaterThanOrEqual(2);
    expect(topics.length).toBeLessThanOrEqual(5);
  });

  it("finds the boundaries where the vocabulary turns over", () => {
    const blocks = buildTopicBlocks(transcript);
    const candidates = boundaryCandidates(blocks);
    expect(candidates.length).toBeGreaterThan(0);
    // The two real subject changes sit at 600s and 1200s in the fixture.
    const best = candidates.slice(0, 2).map((candidate) => candidate.time);
    for (const time of best) {
      expect(Math.min(Math.abs(time - 600), Math.abs(time - 1200))).toBeLessThanOrEqual(60);
    }
  });

  it("keeps every segment inside the length bounds", () => {
    for (const topic of planTopicSegments(transcript)) {
      expect(topic.ranges.length).toBeGreaterThan(0);
      expect(topic.durationSec).toBeGreaterThanOrEqual(120);
      expect(topic.durationSec).toBeLessThanOrEqual(1200);
      expect(topic.end).toBeGreaterThan(topic.start);
      expect(topic.start).toBe(topic.ranges[0].start);
      expect(topic.end).toBe(topic.ranges[topic.ranges.length - 1].end);
    }
  });

  it("never plays the same second of the recording in two segments", () => {
    const ranges = planTopicSegments(transcript)
      .flatMap((topic) => topic.ranges)
      .sort((a, b) => a.start - b.start);
    for (const [index, range] of ranges.entries()) {
      expect(range.end).toBeGreaterThan(range.start);
      if (index > 0) expect(range.start).toBeGreaterThanOrEqual(ranges[index - 1].end);
    }
  });

  it("gathers a subject the stream came back to into one segment", () => {
    const topics = planTopicSegments(interleavedTranscript());
    expect(topics.length).toBeGreaterThanOrEqual(2);
    // Every subject in the fixture is talked about in two separate stretches,
    // so at least one segment has to be assembled from more than one of them.
    const gathered = topics.filter((topic) => topic.ranges.length > 1);
    expect(gathered.length).toBeGreaterThan(0);
    for (const topic of gathered) {
      // The stretches are genuinely apart — a gathered segment is not a window.
      const jumps = topic.ranges.slice(1).map((range, index) => range.start - topic.ranges[index].end);
      expect(Math.max(...jumps)).toBeGreaterThan(60);
      expect(topic.end - topic.start).toBeGreaterThan(topic.durationSec);
      expect(topic.durationSec).toBeLessThanOrEqual(1200);
    }
  });

  it("keeps a gathered segment about one subject", () => {
    const gathered = planTopicSegments(interleavedTranscript()).find((topic) => topic.ranges.length > 1);
    expect(gathered).toBeDefined();
    // Each fixture subject owns a word nothing else says. A boundary can sit a
    // block late and catch a line of the next subject, so what matters is that
    // one subject clearly owns the segment.
    const counts = SUBJECT_MARKERS.map((word) => markerCount(gathered!.text, word)).sort((a, b) => b - a);
    expect(counts[0]).toBeGreaterThan(counts[1] * 5);
  });

  it("gives each segment its own distinctive keywords", () => {
    const topics = planTopicSegments(transcript);
    expect(topics.every((topic) => topic.keywords.length > 0)).toBe(true);
    const first = new Set(topics[0].keywords);
    const last = topics[topics.length - 1].keywords;
    expect(last.some((keyword) => !first.has(keyword))).toBe(true);
  });

  it("never publishes the same subject as two segments", () => {
    // An hour that returns to each of its three subjects three times: the
    // length cap fills a segment and leaves the rest of that subject behind,
    // and that leftover must not come back as a second upload about it.
    const topics = planTopicSegments(transcriptFor([0, 1, 2, 0, 1, 2, 0, 1, 2, 1], 24));
    expect(topics.length).toBeGreaterThan(1);
    const subjects = topics.map((topic) => dominantSubject(topic.text));
    expect(new Set(subjects).size).toBe(topics.length);
  });

  it("honours a pinned segment count", () => {
    const topics = planTopicSegments(transcript, { minCount: 2, maxCount: 2 });
    expect(topics).toHaveLength(2);
  });

  it("returns nothing for a recording too short to carry a segment", () => {
    expect(planTopicSegments([caption(0, 30, "Quick note about the build.")])).toEqual([]);
    expect(planTopicSegments([])).toEqual([]);
  });
});

describe("fallbackTopicTitle", () => {
  it("builds a titled phrase from the keywords, never a transcript fragment", () => {
    expect(fallbackTopicTitle(["hackathon", "deadline", "demo"], 0)).toBe("Hackathon, Deadline and Demo");
    expect(fallbackTopicTitle([], 2)).toBe("Segment 3");
  });
});

describe("parseTopicSegments", () => {
  it("reads titles and summaries out of a fenced JSON reply", () => {
    const parsed = parseTopicSegments(
      '```json\n[{"id":"topic-1","title":"Shipping The Hackathon Build With Claude","summary":"Racing the submission deadline on stream."}]\n```'
    );
    expect(parsed.get("topic-1")).toEqual({
      title: "Shipping The Hackathon Build With Claude",
      summary: "Racing the submission deadline on stream."
    });
  });

  it("drops entries whose title is unusable and survives junk", () => {
    const parsed = parseTopicSegments('[{"id":"topic-1","title":"Nope","summary":"Too short to be a title."}]');
    expect(parsed.size).toBe(0);
    expect(parseTopicSegments("sorry, no json here").size).toBe(0);
  });
});

describe("buildTopicSegmentPrompt", () => {
  it("lists every segment with its id and length", () => {
    const prompt = buildTopicSegmentPrompt(
      [
        { id: "topic-1", minutes: 11, text: "hackathon deadline talk" },
        { id: "topic-2", minutes: 9, text: "pricing page talk" }
      ],
      { streamTitle: "Build day 12" }
    );
    expect(prompt).toContain("Stream: Build day 12");
    expect(prompt).toContain("Segment topic-1 (about 11 minutes long):");
    expect(prompt).toContain("Segment topic-2 (about 9 minutes long):");
  });
});

// ----- Exporting one segment -----

function project(overrides: Partial<LongformProject> = {}): LongformProject {
  return {
    id: "p1",
    name: "Stream",
    sourceId: "s1",
    fileName: "stream.mp4",
    status: "ready",
    stage: "ready",
    progress: 100,
    notices: [],
    durationSec: 1800,
    width: 1920,
    height: 1080,
    hasAudio: true,
    transcript: streamTranscript(),
    silences: [],
    segments: [
      { id: "seg-1", start: 0, end: 600, kind: "speech", enabled: true },
      { id: "seg-2", start: 600, end: 640, kind: "silence", enabled: false },
      { id: "seg-3", start: 640, end: 1800, kind: "speech", enabled: true }
    ],
    hook: {
      enabled: true,
      start: 0,
      end: 7,
      zoom: 1.3,
      focusX: 0.5,
      focusY: 0.35,
      captionsEnabled: true,
      highlightCurrentWord: true,
      captions: [],
      captionStyle: {} as LongformProject["hook"]["captionStyle"]
    },
    captions: { enabled: false, highlightCurrentWord: true, segments: [], style: {} as LongformProject["captions"]["style"] },
    overlays: [],
    music: {
      enabled: true,
      clips: [
        { id: "a1", trackId: "t1", fileName: "bed.mp3", start: 30, duration: 120, volume: 0.1 },
        { id: "a2", trackId: "t1", fileName: "bed.mp3", start: 900, duration: 120, volume: 0.1 }
      ],
      videoVolume: 1,
      masterVolume: 1
    },
    pace: { minSilenceSec: 0.7, paddingSec: 0.15 },
    exports: [],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...overrides
  };
}

const topic: LongformTopic = {
  id: "topic-2",
  title: "Why The Pricing Page Decides Your Revenue",
  summary: "The middle stretch of the stream.",
  start: 700,
  end: 1300,
  keywords: ["pricing", "revenue"],
  titleSource: "ai"
};

describe("projectForTopic", () => {
  it("clips the cut plan to the segment window", () => {
    const view = projectForTopic(project(), topic);
    expect(view.segments).toHaveLength(1);
    expect(view.segments[0].start).toBe(700);
    expect(view.segments[0].end).toBe(1300);
    expect(view.name).toBe(topic.title);
  });

  it("moves the hook onto the segment's opening", () => {
    const view = projectForTopic(project(), topic);
    expect(view.hook.enabled).toBe(true);
    expect(view.hook.start).toBe(700);
    expect(view.hook.end).toBe(707);
  });

  it("never lets the hook take more than half of a short segment", () => {
    const view = projectForTopic(project(), { ...topic, start: 700, end: 704 });
    expect(view.hook.end - view.hook.start).toBeLessThanOrEqual(2);
  });

  it("drops audio clips placed outside the segment", () => {
    const view = projectForTopic(project(), topic);
    expect(view.music.clips.map((clip) => clip.id)).toEqual(["a2"]);
    expect(view.music.clips[0].start).toBe(900);
  });

  it("leaves the stored project untouched", () => {
    const original = project();
    projectForTopic(original, topic);
    expect(original.segments).toHaveLength(3);
    expect(original.music.clips).toHaveLength(2);
  });

  it("reports the segment's own runtime, not the whole edit's", () => {
    const original = project();
    expect(topicDurationSec(original, topic)).toBe(600);
  });

  it("keeps a disabled hook disabled", () => {
    const original = project();
    const view = projectForTopic({ ...original, hook: { ...original.hook, enabled: false } }, topic);
    expect(view.hook.enabled).toBe(false);
  });
});

const gatheredTopic: LongformTopic = {
  id: "topic-1",
  title: "What The Hackathon Deadline Taught Us",
  summary: "Two stretches of the stream about the same build.",
  ranges: [
    { start: 100, end: 400 },
    { start: 1000, end: 1300 }
  ],
  start: 100,
  end: 1300,
  keywords: ["hackathon", "deadline"],
  titleSource: "ai"
};

describe("projectForTopic, gathered from several ranges", () => {
  it("clips the cut plan to every range and leaves the footage between them out", () => {
    const view = projectForTopic(project(), gatheredTopic);
    expect(view.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [100, 400],
      [1000, 1300]
    ]);
    expect(view.segments.map((segment) => segment.id)).toEqual(["seg-1", "seg-2"]);
  });

  it("reports the runtime as the ranges added up, not the span between them", () => {
    expect(topicDurationSec(project(), gatheredTopic)).toBe(600);
  });

  it("opens the hook on the first range", () => {
    const view = projectForTopic(project(), gatheredTopic);
    expect(view.hook.start).toBe(100);
    expect(view.hook.end).toBe(107);
  });

  it("never runs the hook past the first range", () => {
    const view = projectForTopic(project(), {
      ...gatheredTopic,
      ranges: [
        { start: 100, end: 104 },
        { start: 1000, end: 1300 }
      ]
    });
    expect(view.hook.end).toBe(104);
  });

  it("keeps the audio caught by each range and drops the rest", () => {
    const view = projectForTopic(project(), {
      ...gatheredTopic,
      ranges: [
        { start: 0, end: 200 },
        { start: 900, end: 1300 }
      ]
    });
    expect(view.music.clips.map((clip) => clip.id)).toEqual(["a1", "a2"]);
    expect(view.music.clips.map((clip) => clip.start)).toEqual([30, 900]);
  });

  it("splits one placed track caught by two ranges into two clips", () => {
    const view = projectForTopic(
      project({
        music: {
          enabled: true,
          clips: [{ id: "a1", trackId: "t1", fileName: "bed.mp3", start: 0, duration: 1800, volume: 0.1 }],
          videoVolume: 1,
          masterVolume: 1
        }
      }),
      gatheredTopic
    );
    expect(view.music.clips.map((clip) => clip.id)).toEqual(["a1-p1", "a1-p2"]);
    expect(view.music.clips.map((clip) => [clip.start, clip.duration])).toEqual([
      [100, 300],
      [1000, 300]
    ]);
  });

  it("merges overlapping ranges and drops anything past the source", () => {
    const view = projectForTopic(project({ durationSec: 1200 }), {
      ...gatheredTopic,
      ranges: [
        { start: 300, end: 600 },
        { start: 500, end: 700 },
        { start: 1300, end: 1500 }
      ]
    });
    expect(view.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [300, 600],
      [600, 640],
      [640, 700]
    ]);
  });
});
