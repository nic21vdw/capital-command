import { describe, expect, it } from "vitest";
import { pendingHint, pendingLabel, preSchedules } from "@/lib/publisher/nativeScheduling";

describe("which platforms take a post before its time", () => {
  it("hands YouTube the upload ahead of the slot", () => {
    expect(preSchedules("youtube")).toBe(true);
  });

  it("keeps the platforms with no scheduling API for the runner to post", () => {
    expect(preSchedules("instagram")).toBe(false);
    expect(preSchedules("tiktok")).toBe(false);
    expect(preSchedules("facebook")).toBe(false);
  });
});

describe("what a waiting post says on the board", () => {
  it("says a pre-scheduling platform is being handed the file", () => {
    expect(pendingLabel("youtube")).toBe("Uploading");
  });

  it("says the rest are posted at their slot rather than merely queued", () => {
    expect(pendingLabel("instagram")).toBe("Posts at slot");
    expect(pendingLabel("tiktok")).toBe("Posts at slot");
  });

  it("falls back to the queue's own word when no platform is given", () => {
    expect(pendingLabel()).toBe("Queued");
  });

  it("explains why nothing is on the platform yet", () => {
    expect(pendingHint("instagram")).toContain("no scheduling API");
    expect(pendingHint("youtube")).toContain("ahead of time");
  });
});
