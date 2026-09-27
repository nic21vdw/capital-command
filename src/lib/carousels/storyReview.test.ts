import { describe, expect, it } from "vitest";
import { attachSlideBackdrops } from "@/lib/carousels/imageSlides";
import { applyReview, buildReviewPrompt, parseReview } from "@/lib/carousels/storyReview";
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
