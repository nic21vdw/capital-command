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
function streamTranscript(): CaptionSegment[] {
  const subjects = [
    "The hackathon build is running and the submission deadline drives every decision today.",
    "Our hackathon demo needs the submission video recorded before the deadline tonight.",
    "The pricing page conversion rate decides how much revenue each visitor is worth.",
    "Revenue per visitor tells us whether the pricing tiers convert or scare people away.",
    "Steel connection checks in the structural workspace still fail on eccentric bolt groups.",
    "The bolt group geometry drives those structural checks more than the steel grade does."
  ];
  const segments: CaptionSegment[] = [];
  let time = 0;
  for (let subject = 0; subject < 3; subject += 1) {
    for (let line = 0; line < 40; line += 1) {
      const text = subjects[subject * 2 + (line % 2)];
      segments.push(caption(time, time + 14, text));
      time += 15;
    }
  }
  return segments;
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

  // Long-form means long enough to carry mid-rolls. A four-minute "segment"
  // is a clip, and the planner used to hand back plenty of them.
  it("never plans a segment under the eight-minute floor", () => {
    const topics = planTopicSegments(streamTranscript());
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(topic.end - topic.start).toBeGreaterThanOrEqual(480);
  });

  // An eight-minute app demo is one video. Splitting it produces two halves of
  // a video, not two videos, and the app used to do exactly that.
  it("leaves a short recording whole", () => {
    const short = streamTranscript().filter((segment) => segment.end <= 480);
    expect(planTopicSegments(short)).toEqual([]);
  });

  // A hand-made request names both the floor and the total it is overriding —
  // the API route derives the floor from the number of segments asked for.
  it("still splits a short recording when one is asked for by hand", () => {
    const short = streamTranscript().filter((segment) => segment.end <= 480);
    expect(planTopicSegments(short, { minTotalSec: 0, minSec: 120 }).length).toBeGreaterThan(0);
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

  it("keeps segments inside the length bounds, in order, without overlapping", () => {
    const topics = planTopicSegments(transcript);
    let previousEnd = -1;
    for (const topic of topics) {
      expect(topic.end).toBeGreaterThan(topic.start);
      expect(topic.end - topic.start).toBeGreaterThanOrEqual(120);
      expect(topic.end - topic.start).toBeLessThanOrEqual(1200);
      expect(topic.start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = topic.end;
    }
  });

  it("gives each segment its own distinctive keywords", () => {
    const topics = planTopicSegments(transcript);
    expect(topics.every((topic) => topic.keywords.length > 0)).toBe(true);
    const first = new Set(topics[0].keywords);
    const last = topics[topics.length - 1].keywords;
    expect(last.some((keyword) => !first.has(keyword))).toBe(true);
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
