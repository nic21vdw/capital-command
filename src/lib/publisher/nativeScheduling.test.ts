import { describe, expect, it } from "vitest";
import { facebookLead, pendingHint, pendingLabel, preSchedules, preSchedulesItem } from "@/lib/publisher/nativeScheduling";

describe("which platforms take a post before its time", () => {
  it("hands YouTube the upload ahead of the slot", () => {
    expect(preSchedules("youtube")).toBe(true);
  });

  it("keeps the platforms with no scheduling API for the runner to post", () => {
    expect(preSchedules("instagram")).toBe(false);
    expect(preSchedules("tiktok")).toBe(false);
  });
});

describe("Facebook's scheduling window", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const video = (publishAt: string) => ({ publishAt });
  const deck = (publishAt: string) => ({ publishAt, mediaKind: "image" as const });

  it("schedules a Reel between a quarter of an hour and four weeks out", () => {
    expect(facebookLead(at(60 * 60_000), now)).toBe("schedulable");
    expect(preSchedulesItem("facebook", video(at(7 * 24 * 60 * 60_000)), now)).toBe(true);
  });

  it("posts at the slot when there is no room left to schedule", () => {
    expect(facebookLead(at(5 * 60_000), now)).toBe("at-the-slot");
    expect(facebookLead(at(-60_000), now)).toBe("at-the-slot");
    expect(preSchedulesItem("facebook", video(at(5 * 60_000)), now)).toBe(false);
  });

  it("waits on a slot further out than Facebook will take", () => {
    expect(facebookLead(at(60 * 24 * 60 * 60_000), now)).toBe("too-far");
    expect(preSchedulesItem("facebook", video(at(60 * 24 * 60 * 60_000)), now)).toBe(false);
  });

  it("never hands a picture post over early — only a Reel can be scheduled", () => {
    expect(preSchedulesItem("facebook", deck(at(7 * 24 * 60 * 60_000)), now)).toBe(false);
    expect(pendingLabel("facebook", deck(at(7 * 24 * 60 * 60_000)))).toBe("Posts at slot");
    expect(pendingHint("facebook", deck(at(7 * 24 * 60 * 60_000)))).toContain("picture post");
  });

  it("leaves the other platforms' answers alone", () => {
    expect(preSchedulesItem("youtube", video(at(60 * 24 * 60 * 60_000)), now)).toBe(true);
    expect(preSchedulesItem("instagram", video(at(60 * 60_000)), now)).toBe(false);
  });
});

describe("what a waiting post says on the board", () => {
  it("says a pre-scheduling platform is being handed the file", () => {
    expect(pendingLabel("youtube")).toBe("Uploading");
  });

  it("says a Reel inside Facebook's window is being handed over too", () => {
    const publishAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(pendingLabel("facebook", { publishAt })).toBe("Uploading");
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
