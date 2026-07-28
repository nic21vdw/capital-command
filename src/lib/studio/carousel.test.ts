import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The carousel's behaviour when the model will not answer.
 *
 * A real pipeline run shipped eight slides built by slicing the transcript —
 * "💡 Point 3 / (upbeat music) (clapping) (yawning) Alright…" — and reported
 * them as ready to schedule. That fallback is fine in the Video Studio, where
 * someone reads it before posting, and wrong in the Stream Pipeline, where
 * nobody does.
 */

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AI_PROVIDER", "deepseek");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/ai");
});

/** An AI gateway that always declines, counting how many times it was asked. */
function mockAiDeclining() {
  const runAi = vi.fn(async () => ({ text: "", refused: true }));
  vi.doMock("@/lib/ai", () => ({ runAi, aiConfigured: () => true }));
  return runAi;
}

function mockAiFailingThenOk(failures: number) {
  let calls = 0;
  const runAi = vi.fn(async () => {
    calls += 1;
    if (calls <= failures) return { text: "", refused: true };
    return {
      text: JSON.stringify({
        title: "Shipping in public",
        slides: [
          { heading: "The promise", body: "Fifty subscribers, seventy-five push-ups." },
          { heading: "The build", body: "CoLateral is an AI workspace for structural engineers." },
          { heading: "The lesson", body: "Automate the content so the coding gets the hours." },
          { heading: "Follow", body: "New AI and engineering videos every week." }
        ]
      }),
      refused: false
    };
  });
  vi.doMock("@/lib/ai", () => ({ runAi, aiConfigured: () => true }));
  return runAi;
}

const input = {
  title: "50 SUBSCRIBER PUSH-UP APPRECIATION STREAM",
  sourceText: "We had 12 subscribers guys or now we're up to 13. (yawning) Alright, that was a 50 bomb.",
  slideCount: 8,
  sourceType: "longform" as const,
  sourceId: "proj-1"
};

describe("generateCarousel", () => {
  it("retries a declining model before giving up", async () => {
    const runAi = mockAiDeclining();
    const { generateCarousel } = await import("@/lib/studio/carousel");
    await generateCarousel(input);
    expect(runAi).toHaveBeenCalledTimes(3);
  });

  it("succeeds when a retry lands", async () => {
    mockAiFailingThenOk(2);
    const { generateCarousel } = await import("@/lib/studio/carousel");
    const result = await generateCarousel(input);
    expect(result.reason).toBeNull();
    expect(result.carousel?.slides.length).toBeGreaterThan(0);
  });

  // The Video Studio path: a person reviews it, so rough slides beat nothing.
  it("still falls back to simple slides when no one asked for strictness", async () => {
    mockAiDeclining();
    const { generateCarousel } = await import("@/lib/studio/carousel");
    const result = await generateCarousel(input);
    expect(result.carousel).not.toBeNull();
    expect(result.reason).toMatch(/simple slides/i);
  });

  // The pipeline path: unattended, so nothing beats transcript slices.
  it("writes nothing rather than transcript slices when the model is required", async () => {
    mockAiDeclining();
    const { generateCarousel } = await import("@/lib/studio/carousel");
    const result = await generateCarousel({ ...input, requireModel: true });
    expect(result.carousel).toBeNull();
    expect(result.reason).toMatch(/no slides written/i);
    expect(result.reason).toMatch(/3 times/);
  });

  it("does not emit the transcript fragment that started all this", async () => {
    mockAiDeclining();
    const { generateCarousel } = await import("@/lib/studio/carousel");
    const strict = await generateCarousel({ ...input, requireModel: true });
    expect(JSON.stringify(strict.carousel)).not.toMatch(/yawning|Point 1/);
  });
});

/** An AI gateway that always answers, recording the prompt it was given. */
function mockAiWriting(slideCount = 8) {
  const prompts: string[] = [];
  const runAi = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
    prompts.push(request.messages[0].content);
    return {
      text: JSON.stringify({
        title: "Shipping in public",
        slides: Array.from({ length: slideCount }, (_, i) => ({
          heading: `Heading ${i + 1}`,
          body: `Body ${i + 1} — a full sentence so nothing is filtered out.`
        }))
      }),
      refused: false
    };
  });
  vi.doMock("@/lib/ai", () => ({ runAi, aiConfigured: () => true }));
  return { runAi, prompts };
}

const photos = [
  { id: "one.png", url: "/api/studio/carousels/images/one.png", fileName: "one.png" },
  { id: "two.png", url: "/api/studio/carousels/images/two.png", fileName: "two.png" }
];

describe("batches", () => {
  it("writes one carousel per batch, each on its own angle", async () => {
    const { prompts } = mockAiWriting();
    const { generateCarouselBatches, CAROUSEL_ANGLES } = await import("@/lib/studio/carousel");
    const result = await generateCarouselBatches({ ...input, batchCount: 3 });

    expect(result.carousels).toHaveLength(3);
    expect(result.carousels.map((entry) => entry.batch?.index)).toEqual([1, 2, 3]);
    expect(new Set(result.carousels.map((entry) => entry.batch?.groupId)).size).toBe(1);
    expect(result.carousels.map((entry) => entry.batch?.angle)).toEqual(
      CAROUSEL_ANGLES.slice(0, 3).map((angle) => angle.label)
    );
    // Three different briefs, or it's the same post three times.
    expect(new Set(prompts).size).toBe(3);
  });

  it("asks for a single carousel exactly as the pipeline always has", async () => {
    const { prompts } = mockAiWriting();
    const { generateCarouselBatches } = await import("@/lib/studio/carousel");
    const result = await generateCarouselBatches({ ...input, batchCount: 1 });

    expect(result.carousels).toHaveLength(1);
    expect(result.carousels[0].batch).toBeUndefined();
    expect(prompts[0]).not.toMatch(/Angle for this carousel|of \d+ written from the SAME source/);
  });

  it("caps the batch count instead of firing an unbounded fan-out", async () => {
    mockAiWriting();
    const { generateCarouselBatches, MAX_BATCH_COUNT } = await import("@/lib/studio/carousel");
    const result = await generateCarouselBatches({ ...input, batchCount: 99 });
    expect(result.carousels).toHaveLength(MAX_BATCH_COUNT);
  });

  it("returns the batches that landed and says how many did not", async () => {
    // Batches run concurrently, so which batch a call belongs to is read off
    // the prompt rather than the call order.
    const runAi = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
      if (request.messages[0].content.includes("carousel 2 of 2")) return { text: "", refused: true };
      return {
        text: JSON.stringify({
          title: "Shipping in public",
          slides: Array.from({ length: 4 }, (_, i) => ({ heading: `H${i}`, body: `Body ${i} of the carousel.` }))
        }),
        refused: false
      };
    });
    vi.doMock("@/lib/ai", () => ({ runAi, aiConfigured: () => true }));
    const { generateCarouselBatches } = await import("@/lib/studio/carousel");
    const result = await generateCarouselBatches({ ...input, batchCount: 2, requireModel: true });
    expect(result.carousels).toHaveLength(1);
    expect(result.reason).toMatch(/1 of 2 batches/);
  });
});

describe("photo batches", () => {
  it("tells the model how many slides already carry a photo, and what they show", async () => {
    const { prompts } = mockAiWriting();
    const { generateCarouselBatches } = await import("@/lib/studio/carousel");
    await generateCarouselBatches({ ...input, images: photos, imageNotes: "1. the whiteboard. 2. the failing test." });

    expect(prompts[0]).toMatch(/first 2 slides already carry a supplied photo/);
    expect(prompts[0]).toMatch(/the failing test/);
  });

  it("gives every uploaded photo a slide, even when the model writes fewer", async () => {
    mockAiWriting(3);
    const { generateCarousel } = await import("@/lib/studio/carousel");
    const many = [...photos, { id: "three.png", url: "/api/studio/carousels/images/three.png" }, { id: "four.png", url: "/api/studio/carousels/images/four.png" }];
    const result = await generateCarousel({ ...input, images: many });

    const slides = result.carousel?.slides ?? [];
    expect(slides).toHaveLength(4);
    expect(slides.filter((slide) => slide.layers?.some((layer) => layer.type === "image"))).toHaveLength(4);
    expect(result.reason).toMatch(/1 photo got a slide with no copy/);
  });

  it("sizes the deck to the photos when there are more of them than slides asked for", async () => {
    const { resolveSlideCount, MAX_SLIDES } = await import("@/lib/carousels/deck");
    expect(resolveSlideCount({ slideCount: 8, imageCount: 12 })).toBe(12);
    expect(resolveSlideCount({ slideCount: 8, imageCount: 2 })).toBe(8);
    expect(resolveSlideCount({ slideCount: 8, imageCount: 500 })).toBe(MAX_SLIDES);
  });

  it("keeps the fallback deck long enough to hold every photo", async () => {
    mockAiDeclining();
    const { fallbackCarousel } = await import("@/lib/studio/carousel");
    expect(fallbackCarousel({ ...input, slideCount: 12 }).slides).toHaveLength(12);
  });
});
