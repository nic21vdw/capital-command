import { describe, expect, it } from "vitest";
import { VIRAL_HOOK_CAPTION_STYLE, hookCaptions } from "@/lib/longform/plan";
import { reviewTopicOpening, reviewTopicOpenings, segmentReviewHeadline, weakSegmentOpenings } from "@/lib/longform/segment-review";
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

const OPENING = "Here is the mistake that cost me three months of revenue on the pricing page.";
const FILLER = "um so yeah anyway it was basically that thing again from before you know";

function transcript(): CaptionSegment[] {
  const lines: CaptionSegment[] = [];
  for (let t = 0; t < 1800; t += 15) {
    lines.push(caption(t, t + 15, t === 600 ? OPENING : t === 1200 ? FILLER : "we kept shipping the pricing page and watching what changed in the numbers"));
  }
  return lines;
}

function project(overrides: Partial<LongformProject> = {}): LongformProject {
  const captions = transcript();
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
    transcript: captions,
    silences: [],
    segments: [{ id: "seg-1", start: 0, end: 1800, kind: "speech", enabled: true }],
    hook: {
      enabled: true,
      start: 0,
      end: 30,
      zoom: 1.12,
      focusX: 0.5,
      focusY: 0.45,
      captionsEnabled: true,
      highlightCurrentWord: true,
      motionEnabled: true,
      captions: hookCaptions(captions, 0, 30),
      captionStyle: { ...VIRAL_HOOK_CAPTION_STYLE }
    },
    captions: { enabled: true, highlightCurrentWord: true, segments: [], style: VIRAL_HOOK_CAPTION_STYLE },
    overlays: [],
    music: { enabled: false, clips: [], videoVolume: 1, masterVolume: 1 },
    pace: { minSilenceSec: 0.7, paddingSec: 0.15 },
    exports: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides
  };
}

const topic: LongformTopic = {
  id: "topic-1",
  title: "What The Pricing Page Cost Us",
  summary: "The middle stretch.",
  start: 600,
  end: 1200,
  keywords: ["pricing"],
  titleSource: "ai"
};

describe("reviewTopicOpening", () => {
  it("passes a segment that opens on a real line with the treatment on", () => {
    const review = reviewTopicOpening(project(), topic);
    expect(review.verdict).toBe("strong");
    expect(review.missingTreatment).toEqual([]);
    expect(review.start).toBe(600);
    expect(review.runtimeSec).toBe(600);
    expect(segmentReviewHeadline(review)).toContain("Opens strong");
  });

  it("flags a segment whose opening burns no words on screen", () => {
    const base = project();
    const review = reviewTopicOpening({ ...base, hook: { ...base.hook, captionsEnabled: false } }, topic);
    expect(review.verdict).toBe("weak");
    expect(review.missingTreatment.join(" ")).toContain("no words on screen");
  });

  it("flags a segment that opens with no motion and no push-in", () => {
    const base = project();
    const review = reviewTopicOpening(
      { ...base, hook: { ...base.hook, motionEnabled: false, zoom: 1 } },
      topic
    );
    expect(review.missingTreatment).toHaveLength(2);
    expect(review.verdict).toBe("weak");
  });

  it("flags a segment with no hook block at all", () => {
    const base = project();
    const review = reviewTopicOpening({ ...base, hook: { ...base.hook, enabled: false } }, topic);
    expect(review.missingTreatment[0]).toContain("no hook block");
  });

  it("flags a segment shorter than a long-form upload", () => {
    const review = reviewTopicOpening(project(), { ...topic, end: 900 });
    expect(review.verdict).toBe("weak");
    expect(review.missingTreatment.join(" ")).toContain("8 minute floor");
  });

  // A long stream is transcribed only as far as the hook needs. The words for a
  // segment three hours in are read from the whole recording when it renders,
  // so "no captions stored" is not a fault to report — it flagged 27 segments.
  it("does not call an untranscribed opening captionless", () => {
    const base = project({ transcript: transcript().filter((line) => line.end <= 120) });
    const review = reviewTopicOpening(base, topic);
    expect(review.missingTreatment).toEqual([]);
    expect(review.verdict).toBe("unknown");
    expect(review.reasons.join(" ")).toContain("read from the whole recording");
  });

  it("still reports hook captions that were switched off", () => {
    const base = project({ transcript: transcript().filter((line) => line.end <= 120) });
    const review = reviewTopicOpening({ ...base, hook: { ...base.hook, captionsEnabled: false } }, topic);
    expect(review.missingTreatment.join(" ")).toContain("switched off");
  });

  it("says a short segment's runtime without rounding it to sixty seconds", () => {
    const review = reviewTopicOpening(project(), { ...topic, end: 900 });
    expect(review.missingTreatment.join(" ")).toContain("5m 00s");
  });

  it("reads the words the segment actually opens on, not the stream's", () => {
    const review = reviewTopicOpening(project(), topic);
    expect(review.opening.toLowerCase()).toContain("mistake");
  });
});

describe("reviewTopicOpenings", () => {
  it("reviews every segment and ranks the ones to fix first", () => {
    const base = project({
      topics: [topic, { ...topic, id: "topic-2", start: 1200, end: 1800 }],
      hook: { ...project().hook, motionEnabled: false, zoom: 1, captionsEnabled: false }
    });
    const reviews = reviewTopicOpenings(base);
    expect(reviews).toHaveLength(2);
    expect(weakSegmentOpenings(reviews)).toHaveLength(2);
    expect(weakSegmentOpenings(reviews)[0].missingTreatment.length).toBeGreaterThan(0);
  });

  it("returns nothing when the recording was never split", () => {
    expect(reviewTopicOpenings(project())).toEqual([]);
  });
});
