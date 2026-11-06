import { describe, expect, it } from "vitest";
import { attachSlideBackdrops } from "@/lib/carousels/imageSlides";
import { applyReview, buildReviewPrompt, hookCropWindow, parseReview } from "@/lib/carousels/storyReview";
import type { Carousel } from "@/types/domain";

const written: Carousel = {
  id: "carousel-review",
  title: "Review",
  sourceType: "longform",
  createdAt: "2026-09-27T00:00:00.000Z",
  slides: attachSlideBackdrops(
    [
      { id: "s1", heading: "Hook", body: "" },
      { id: "s2", heading: "Terminal", body: "The agent ran." },
      { id: "s3", heading: "Next", body: "Follow along." }
    ],
    [
      { id: "a.jpg", url: "/api/studio/carousels/images/a.jpg" },
      { id: "b.jpg", url: "/api/studio/carousels/images/b.jpg" },
      null
    ]
  )
};

describe("the story review", () => {
  it("asks for every picture to be opened and every slide kept in place", () => {
    const prompt = buildReviewPrompt(written.slides, ["C:/tmp/slide-01.jpg", "C:/tmp/slide-02.jpg", null]);
    expect(prompt).toContain("C:/tmp/slide-01.jpg");
    expect(prompt).toContain('"picture": "none"');
    expect(prompt).toContain("Read tool");
    expect(prompt).toContain("same number of slides, in the same order");
  });

  it("reviews a deck with no stills as a story alone, without asking for pictures", () => {
    const prompt = buildReviewPrompt([{ id: "a", heading: "Hook", body: "" }, { id: "b", heading: "Next", body: "" }], [null, null]);
    expect(prompt).not.toContain("Read tool");
    expect(prompt).not.toContain('"picture"');
    expect(prompt).toContain("would I swipe to the next one?");
    expect(prompt).toContain("colateralai.com");
  });

  it("checks the original source instead of preserving an unsupported draft claim", () => {
    const prompt = buildReviewPrompt(written.slides, [null, null, null], [], "The forecast figures are invented demo assumptions. No customer result was measured.");
    expect(prompt).toContain("Original source evidence:");
    expect(prompt).toContain("No customer result was measured.");
    expect(prompt).toContain("draft is not proof");
    expect(prompt).toContain("remove or qualify a claim");
    expect(prompt).not.toContain("Keep every fact, number and name that is in the copy now");
  });

  it("does not treat a context still as proof of a completed task", () => {
    const prompt = buildReviewPrompt(written.slides, ["slide.jpg", null, null]);
    expect(prompt).toContain("pictures do not establish the source's claims");
    expect(prompt).not.toContain("each slide's picture is a still cut from that recording at the moment");
  });

  it("honors an explicitly cleared body and rejects an incomplete rewrite", () => {
    const review = parseReview(JSON.stringify({ slides: written.slides.map((slide) => ({ heading: slide.heading, body: "" })) }), 3);
    expect(applyReview(written, review!).slides[1].body).toBe("");
    expect(parseReview(JSON.stringify({ slides: written.slides.map((slide) => ({ heading: slide.heading })) }), 3)).toBeNull();
  });

  it("does not restore a cleared unsupported heading over the replacement body", () => {
    const review = parseReview(JSON.stringify({ slides: written.slides.map((slide, index) => ({ heading: index === 1 ? "" : slide.heading, body: "Only the source-supported statement remains." })) }), 3);
    expect(applyReview(written, review!).slides[1]).toMatchObject({ heading: "", body: "Only the source-supported statement remains." });
  });

  it("refuses a reply that changes how many slides there are", () => {
    expect(parseReview('{"slides":[{"heading":"a","body":"b","picture":"keep"}]}', 3)).toBeNull();
  });

  it("rewrites the copy and takes a mismatched picture off its slide", () => {
    const review = parseReview(
      JSON.stringify({
        slides: [
          { heading: "the **update** stalled", body: "", picture: "drop" },
          { heading: "Terminal", body: "The **agent** ran.", picture: "keep" },
          { heading: "Next", body: "Follow along.", picture: "keep" }
        ],
        notes: "Dropped the hook still."
      }),
      3
    );
    expect(review).not.toBeNull();
    const reviewed = applyReview(written, review!);
    const [hook, middle] = reviewed.slides;
    expect(hook.heading).toBe("The **Update** Stalled");
    expect(hook.layers).toBeUndefined();
    expect(hook.scrim).toBeUndefined();
    expect(hook.textBand).toBeUndefined();
    expect(hook.headingColor).toBeUndefined();
    expect(middle.body).toBe("The **agent** ran.");
    expect(middle.layers?.[0]).toMatchObject({ type: "image", src: "/api/studio/carousels/images/b.jpg" });
  });
});

describe("choosing the hook frame", () => {
  it("asks for the most scroll-stopping candidate and where its subject sits", () => {
    const prompt = buildReviewPrompt(written.slides, [null, null, null], ["hook-01.jpg", "hook-02.jpg"]);
    expect(prompt).toContain("hook-01.jpg, hook-02.jpg");
    expect(prompt).toContain('"hookFocus"');
    expect(prompt).toContain("small webcam box in a corner does not count");
  });

  it("reads the pick and clamps the focus", () => {
    const reply = JSON.stringify({ hookPicture: "hook-02.jpg", hookFocus: 1.4, slides: written.slides.map((s) => ({ heading: s.heading, body: s.body || "x" })) });
    expect(parseReview(reply, 3)).toMatchObject({ hookPicture: "hook-02.jpg", hookFocus: 1 });
    const none = JSON.stringify({ hookPicture: "none", slides: written.slides.map((s) => ({ heading: s.heading, body: "x" })) });
    expect(parseReview(none, 3)).toMatchObject({ hookPicture: null, hookFocus: 0.5 });
  });

  it("cuts a 4:5 window around the subject without leaving the frame", () => {
    expect(hookCropWindow(1440, 810, 0.5)).toEqual({ x: 396, width: 648 });
    expect(hookCropWindow(1440, 810, 0)).toEqual({ x: 0, width: 648 });
    expect(hookCropWindow(1440, 810, 1)).toEqual({ x: 792, width: 648 });
  });
});
