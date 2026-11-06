import { describe, expect, it } from "vitest";
import { canvasMayChange, parseReviewField, reviewFieldId, reviewPolicySurface } from "@/components/layout/review-policy-surface";
import { DEFAULT_REVIEW_POLICY, normalizeReviewPolicy } from "@/lib/publisher/approval";

describe("what Settings tells the canvas about the review policy", () => {
  it("offers one auto or hold choice per channel", () => {
    const { fields } = reviewPolicySurface(DEFAULT_REVIEW_POLICY);
    expect(fields.map((field) => field.id)).toEqual([
      "review-youtube",
      "review-instagram",
      "review-tiktok",
      "review-facebook",
      "review-threads",
      "review-linkedin"
    ]);
    for (const field of fields) {
      expect(field).toMatchObject({ kind: "select", options: ["auto", "hold"], value: "auto" });
    }
  });

  it("reflects what is on hold", () => {
    const surface = reviewPolicySurface(normalizeReviewPolicy({ instagram: "hold", threads: "hold" }));
    expect(surface.fields.find((field) => field.id === "review-instagram")?.value).toBe("hold");
    expect(surface.fields.find((field) => field.id === "review-tiktok")?.value).toBe("auto");
    expect(surface.readings).toEqual([{ label: "Channels held for approval", value: "Instagram Reels, Threads" }]);
    expect(reviewPolicySurface(DEFAULT_REVIEW_POLICY).readings[0].value).toBe("None");
  });

  it("reads a write back to the channel it names", () => {
    expect(parseReviewField(reviewFieldId("tiktok"), "hold")).toEqual({ channel: "tiktok", mode: "hold" });
  });

  it("lets the canvas hold a channel but not release one, because release posts what is waiting", () => {
    expect(canvasMayChange({ channel: "instagram", mode: "hold" })).toBe(true);
    expect(canvasMayChange({ channel: "instagram", mode: "auto" })).toBe(false);
    expect(canvasMayChange({ channel: "tiktok", mode: "auto" })).toBe(false);
    expect(canvasMayChange({ channel: "linkedin", mode: "hold" })).toBe(true);
    expect(canvasMayChange({ channel: "linkedin", mode: "auto" })).toBe(false);
  });

  it("leaves other fields alone and refuses a bad write", () => {
    expect(parseReviewField("displayName", "hold")).toBeUndefined();
    expect(parseReviewField("review-bluesky", "hold")).toBeNull();
    expect(parseReviewField("review-tiktok", "sometimes")).toBeNull();
    expect(parseReviewField("review-tiktok", true)).toBeNull();
  });
});
