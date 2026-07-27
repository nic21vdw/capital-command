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
