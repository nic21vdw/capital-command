import { describe, expect, it } from "vitest";
import { chooseWinner, type Baselines, type PostScore } from "@/lib/experiments/winner";
import { MIN_VARIANT_VIEWS, TIE_MARGIN } from "@/lib/experiments/types";

const baselines: Baselines = {
  "youtube:youtube-primary": { views: 1000, engagementRate: 0.04, posts: 12 },
  "instagram:instagram-primary": { views: 300, engagementRate: 0.06, posts: 12 },
  "youtube:youtube-second": { views: 2000, engagementRate: 0.04, posts: 9 }
};

function score(variantId: string, platform: string, views: number, engagementRate: number | null = null, accountId = `${platform}-primary`): PostScore {
  return { variantId, platform, accountId, views, engagementRate };
}

describe("chooseWinner", () => {
  it("normalises by platform: the variant that beat its own platform's median wins, not the one with more raw views", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 2000), score("B", "instagram", 900)],
      baselines
    });
    expect(result.outcome).toBe("winner");
    expect(result.winnerId).toBe("B");
    expect(result.scores.find((entry) => entry.variantId === "A")?.viewsIndex).toBeCloseTo(2, 5);
    expect(result.scores.find((entry) => entry.variantId === "B")?.viewsIndex).toBeCloseTo(3, 5);
  });

  it("normalises by the account's median, so two accounts on one platform are compared fairly", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 1600), score("B", "youtube", 2400, null, "youtube-second")],
      baselines
    });
    expect(result.winnerId).toBe("A");
  });

  it("averages a variant's posts across platforms", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 3000), score("A", "instagram", 150), score("B", "youtube", 1500), score("B", "instagram", 330)],
      baselines
    });
    expect(result.scores.find((entry) => entry.variantId === "A")?.viewsIndex).toBeCloseTo((3 + 0.5) / 2, 5);
    expect(result.scores.find((entry) => entry.variantId === "B")?.viewsIndex).toBeCloseTo((1.5 + 1.1) / 2, 5);
    expect(result.winnerId).toBe("A");
  });

  it("lets engagement rate decide when views are level", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 1000, 0.06), score("B", "youtube", 1000, 0.02)],
      baselines
    });
    expect(result.winnerId).toBe("A");
  });

  it("uses views alone unless every variant has an engagement rate", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 1300, 0.001), score("B", "youtube", 1000, null)],
      baselines
    });
    expect(result.winnerId).toBe("A");
    for (const entry of result.scores) expect(entry.score).toBe(entry.viewsIndex);
  });

  it("calls identical results a tie and names both variants", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 1500), score("B", "youtube", 1500)],
      baselines
    });
    expect(result.outcome).toBe("tie");
    expect(result.winnerId).toBeNull();
    expect(result.tiedIds).toEqual(["A", "B"]);
    expect(result.message).toMatch(/too close/i);
  });

  it(`calls a lead under ${TIE_MARGIN * 100}% a tie and a lead over it a winner`, () => {
    const close = chooseWinner({ variantIds: ["A", "B"], posts: [score("A", "youtube", 1080), score("B", "youtube", 1000)], baselines });
    const clear = chooseWinner({ variantIds: ["A", "B"], posts: [score("A", "youtube", 1120), score("B", "youtube", 1000)], baselines });
    expect(close.outcome).toBe("tie");
    expect(clear.outcome).toBe("winner");
    expect(clear.winnerId).toBe("A");
  });

  it("ties only the variants that are within the margin of the best, in a three-way test", () => {
    const result = chooseWinner({
      variantIds: ["A", "B", "C"],
      posts: [score("A", "youtube", 1500), score("B", "youtube", 1450), score("C", "youtube", 800)],
      baselines
    });
    expect(result.outcome).toBe("tie");
    expect(result.tiedIds).toEqual(["A", "B"]);
  });

  it("picks the winner of a three-way test and names the runner-up", () => {
    const result = chooseWinner({
      variantIds: ["A", "B", "C"],
      posts: [score("A", "youtube", 900), score("B", "youtube", 2400), score("C", "youtube", 1300)],
      baselines
    });
    expect(result.winnerId).toBe("B");
    expect(result.runnerUpId).toBe("C");
  });

  it(`reports not enough data when a variant is under ${MIN_VARIANT_VIEWS} views, however good it looks`, () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "instagram", 90), score("B", "instagram", 150)],
      baselines
    });
    expect(result.outcome).toBe("not-enough-data");
    expect(result.winnerId).toBeNull();
    expect(result.message).toMatch(/not enough data/i);
    expect(result.message).toContain("A");
    expect(result.message).toContain(String(MIN_VARIANT_VIEWS));
  });

  it("counts the views of all of a variant's posts toward the minimum", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "instagram", 60), score("A", "instagram", 60), score("B", "instagram", 150), score("B", "instagram", 150)],
      baselines
    });
    expect(result.outcome).not.toBe("not-enough-data");
  });

  it("takes the minimum from the options when given", () => {
    const posts = [score("A", "instagram", 90), score("B", "instagram", 400)];
    expect(chooseWinner({ variantIds: ["A", "B"], posts, baselines, minViews: 50 }).outcome).toBe("winner");
    expect(chooseWinner({ variantIds: ["A", "B"], posts, baselines, minViews: 500 }).outcome).toBe("not-enough-data");
  });

  it("reports not enough data when a variant has no post to measure", () => {
    const result = chooseWinner({ variantIds: ["A", "B"], posts: [score("A", "youtube", 1500)], baselines });
    expect(result.outcome).toBe("not-enough-data");
  });

  it("reports not enough data when the account has no baseline to measure against", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "tiktok", 5000), score("B", "tiktok", 800)],
      baselines
    });
    expect(result.outcome).toBe("not-enough-data");
    expect(result.message).toMatch(/baseline|usual|median/i);
  });

  it("measures a variant on the platforms that have a baseline and ignores the ones that do not", () => {
    const result = chooseWinner({
      variantIds: ["A", "B"],
      posts: [score("A", "youtube", 2000), score("A", "tiktok", 9000), score("B", "youtube", 1000)],
      baselines
    });
    expect(result.winnerId).toBe("A");
    expect(result.scores.find((entry) => entry.variantId === "A")?.normalisedPosts).toBe(1);
  });
});
