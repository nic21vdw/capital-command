import { describe, expect, it, vi } from "vitest";
import { buildTimeline, PRODUCT_MOMENT_RULE, selectByTranscript, transcriptClipScore } from "./transcript-select";
import type { CaptionSegment } from "@/types/domain";

const ai = vi.hoisted(() => ({ prompts: [] as string[], reply: "[]" }));

vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  runAi: async (request: { messages: Array<{ content: string }> }) => {
    ai.prompts.push(request.messages[0].content);
    return { text: ai.reply, refused: false };
  }
}));

function seg(start: number, text: string): CaptionSegment {
  return { id: `s-${start}`, start, end: start + 4, text, words: [], enabled: true };
}

describe("buildTimeline", () => {
  it("covers the whole stream end-to-end, not just the start", () => {
    // A 2-hour stream with a line every 30s.
    const duration = 7200;
    const segments: CaptionSegment[] = [];
    for (let t = 0; t < duration; t += 30) segments.push(seg(t, `line at ${t}`));

    const timeline = buildTimeline(segments, duration);

    // The opening, a mid-stream moment, and the very end all make it in.
    expect(timeline).toContain("line at 0");
    expect(timeline).toContain("line at 3600");
    expect(timeline).toContain("line at 7170");
  });

  it("formats timestamps as h:mm:ss past the first hour", () => {
    const timeline = buildTimeline([seg(0, "hello"), seg(3700, "later")], 4000);
    expect(timeline).toContain("[00:00] hello");
    // Bucketed to the 6s grid (floor(3700/6)*6 = 3696 = 1:01:36).
    expect(timeline).toContain("[1:01:36] later");
  });

  it("keeps the line budget bounded for very long streams", () => {
    const duration = 36000; // 10 hours
    const segments: CaptionSegment[] = [];
    for (let t = 0; t < duration; t += 5) segments.push(seg(t, `t${t}`));

    const lines = buildTimeline(segments, duration).split("\n");
    expect(lines.length).toBeLessThanOrEqual(1500);
    // Still reaches the final stretch of the stream.
    expect(lines[lines.length - 1]).toContain("9:");
  });
});

describe("favouring on-screen CoLateral moments", () => {
  const speech = { hook: 70, pacing: 70, standalone: 70, intensity: 70 };

  it("adds a bonus for the product visibly working and nothing when it is absent", () => {
    expect(transcriptClipScore(speech)).toBe(70);
    expect(transcriptClipScore({ ...speech, product: 0 })).toBe(70);
    expect(transcriptClipScore({ ...speech, product: 100 })).toBe(95);
    expect(transcriptClipScore({ hook: 95, pacing: 95, standalone: 95, intensity: 95, product: 100 })).toBe(100);
  });

  it("asks for the product moment and an opening within three seconds", async () => {
    ai.prompts.length = 0;
    const segments = Array.from({ length: 40 }, (_, i) => seg(i * 5, `line ${i}`));
    await selectByTranscript(segments, 200, undefined, 3);
    expect(ai.prompts[0]).toContain(PRODUCT_MOMENT_RULE);
    expect(PRODUCT_MOMENT_RULE).toMatch(/no more than 3 seconds before/);
    expect(ai.prompts[0]).toContain('"product": 0-100');
  });

  it("ranks a clip with CoLateral on screen above an equal one without", async () => {
    ai.reply = JSON.stringify([
      { start: 10, end: 40, title: "Talk", reason: "r", hook: 80, pacing: 80, standalone: 80, intensity: 80, product: 0 },
      { start: 100, end: 130, title: "Agent Finishes", reason: "r", hook: 80, pacing: 80, standalone: 80, intensity: 80, product: 90 }
    ]);
    const segments = Array.from({ length: 40 }, (_, i) => seg(i * 5, `line ${i}.`));
    const clips = await selectByTranscript(segments, 200, undefined, 3);
    expect(clips?.[0].title).toBe("Agent Finishes");
    expect(clips?.[0].breakdown.product).toBe(90);
    expect(clips![0].score).toBeGreaterThan(clips![1].score);
  });
});
