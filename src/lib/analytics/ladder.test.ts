import { describe, expect, it } from "vitest";
import { createLadder } from "@/lib/analytics/ladder";

describe("createLadder", () => {
  it("starts every kind at the first set", () => {
    const ladder = createLadder(3);

    expect(ladder.start("REELS")).toBe(0);
    expect(ladder.start("FEED")).toBe(0);
  });

  it("does not move on after one media is refused", () => {
    const ladder = createLadder(3);

    ladder.refused("REELS", 0, "a");

    expect(ladder.start("REELS")).toBe(0);
  });

  it("moves a kind on once two different media have been refused the same way", () => {
    const ladder = createLadder(3);

    ladder.refused("REELS", 0, "a");
    ladder.refused("REELS", 0, "a");
    expect(ladder.start("REELS")).toBe(0);
    ladder.refused("REELS", 0, "b");

    expect(ladder.start("REELS")).toBe(1);
  });

  it("keeps kinds apart", () => {
    const ladder = createLadder(3);

    ladder.refused("REELS", 0, "a");
    ladder.refused("REELS", 0, "b");

    expect(ladder.start("REELS")).toBe(1);
    expect(ladder.start("FEED")).toBe(0);
    ladder.refused("FEED", 0, "c");
    expect(ladder.start("FEED")).toBe(0);
  });

  it("forgets the refusals of a set that a media then gets through", () => {
    const ladder = createLadder(3);

    ladder.refused("REELS", 0, "a");
    ladder.accepted("REELS", 0);
    ladder.refused("REELS", 0, "b");

    expect(ladder.start("REELS")).toBe(0);
  });

  it("is exhausted once the last set has been refused twice by different media, and never moves past it", () => {
    const ladder = createLadder(2);
    ladder.refused("FEED", 0, "a");
    ladder.refused("FEED", 0, "b");
    expect(ladder.exhausted("FEED")).toBe(false);

    ladder.refused("FEED", 1, "a");
    expect(ladder.exhausted("FEED")).toBe(false);
    ladder.refused("FEED", 1, "b");

    expect(ladder.exhausted("FEED")).toBe(true);
    expect(ladder.start("FEED")).toBe(1);
    expect(ladder.exhausted("REELS")).toBe(false);
  });

  it("ignores a refusal of a set the kind has already moved past", () => {
    const ladder = createLadder(3);
    ladder.refused("REELS", 0, "a");
    ladder.refused("REELS", 0, "b");

    ladder.refused("REELS", 0, "c");
    ladder.refused("REELS", 0, "d");

    expect(ladder.start("REELS")).toBe(1);
  });

  it("counts a refusal of a later set too, so two media refused all the way down settle the kind at the bottom", () => {
    const ladder = createLadder(3);
    for (const id of ["a", "b"]) {
      ladder.refused("FEED", 0, id);
      ladder.refused("FEED", 1, id);
      ladder.refused("FEED", 2, id);
    }

    expect(ladder.start("FEED")).toBe(2);
    expect(ladder.exhausted("FEED")).toBe(true);
  });

  it("keeps a proven set for every later media, however many others are refused on it: the replay", () => {
    const ladder = createLadder(2);

    ladder.accepted("REELS", 0);
    ladder.accepted("REELS", 0);
    for (const id of ["o1", "o2"]) {
      ladder.refused("REELS", 0, id);
      ladder.refused("REELS", 1, id);
    }

    expect(ladder.start("REELS")).toBe(0);
    expect(ladder.exhausted("REELS")).toBe(false);
  });

  it("only exhausts a kind when no set was ever proven for it", () => {
    const proven = createLadder(2);
    proven.accepted("FEED", 1);
    for (const id of ["a", "b"]) {
      proven.refused("FEED", 0, id);
      proven.refused("FEED", 1, id);
    }
    expect(proven.exhausted("FEED")).toBe(false);

    const unproven = createLadder(2);
    for (const id of ["a", "b"]) {
      unproven.refused("FEED", 0, id);
      unproven.refused("FEED", 1, id);
    }
    expect(unproven.exhausted("FEED")).toBe(true);
  });

  it("does not let refusals of a proven set move the kind on, even before it reaches the last set", () => {
    const ladder = createLadder(3);
    ladder.accepted("FEED", 0);

    ladder.refused("FEED", 0, "a");
    ladder.refused("FEED", 0, "b");

    expect(ladder.start("FEED")).toBe(0);
  });

  it("proves a set per kind, not for all of them", () => {
    const ladder = createLadder(2);
    ladder.accepted("REELS", 0);

    ladder.refused("FEED", 0, "a");
    ladder.refused("FEED", 0, "b");

    expect(ladder.start("FEED")).toBe(1);
    expect(ladder.start("REELS")).toBe(0);
  });
});
