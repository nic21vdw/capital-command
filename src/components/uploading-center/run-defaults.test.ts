import { describe, expect, it } from "vitest";
import { TITLE_MAX_LENGTH } from "@/components/uploading-center/clip-card";
import {
  DEFAULT_RUN_DEFAULTS,
  applyHashtags,
  draftWithDefaults,
  hydrateDraft,
  pruneDrafts,
  redraftWithDefaults,
  withoutHashtag,
  type PersistedDraft,
  type RunDefaults
} from "@/components/uploading-center/run-defaults";
import type { ClipDraft, ReadyClip } from "@/components/uploading-center/use-uploading-center";

const clip = (headline: string): ReadyClip => ({
  key: "job1/clip-1.mp4",
  jobId: "job1",
  clipId: "clip-1",
  file: "clip-1.mp4",
  allFiles: ["clip-1.mp4"],
  headline,
  durationSec: 30,
  thumbnailUrl: "",
  previewUrl: "",
  startSec: 0,
  needsRerender: false
});

const draft = (over: Partial<ClipDraft> = {}): ClipDraft => ({
  title: "How I ship features fast",
  caption: "",
  platform: "youtube",
  slotUtc: "",
  ...over
});

describe("applyHashtags", () => {
  it("appends every hashtag in order", () => {
    expect(applyHashtags("My clip", ["#AI", "#coding"])).toBe("My clip #AI #coding");
  });

  it("never doubles a hashtag the title already carries", () => {
    expect(applyHashtags("My clip #AI", ["#ai", "#coding"])).toBe("My clip #AI #coding");
  });

  it("stops at the title length limit instead of truncating the title", () => {
    const long = "x".repeat(TITLE_MAX_LENGTH - 4);
    expect(applyHashtags(long, ["#AI", "#buildinpublic"])).toBe(`${long} #AI`);
  });
});

describe("withoutHashtag", () => {
  it("removes the tag and the space it sat behind", () => {
    expect(withoutHashtag("My clip #AI #coding", "#AI")).toBe("My clip #coding");
  });

  it("leaves a longer hashtag that merely starts with the same word", () => {
    expect(withoutHashtag("My clip #AIagents", "#AI")).toBe("My clip #AIagents");
  });

  it("is case-insensitive, like the chips that added it", () => {
    expect(withoutHashtag("My clip #ai", "#AI")).toBe("My clip");
  });
});

describe("draftWithDefaults", () => {
  it("starts every clip on the run's platform with the run's hashtags", () => {
    const defaults: RunDefaults = { platform: "all", hashtags: ["#AI", "#startup"] };
    expect(draftWithDefaults(clip("Shipping fast"), defaults)).toEqual({
      title: "Shipping fast #AI #startup",
      caption: "",
      platform: "all",
      slotUtc: ""
    });
  });

  it("defaults to YouTube with no hashtags before anything is chosen", () => {
    expect(draftWithDefaults(clip("Shipping fast"), DEFAULT_RUN_DEFAULTS)).toEqual({
      title: "Shipping fast",
      caption: "",
      platform: "youtube",
      slotUtc: ""
    });
  });
});

describe("redraftWithDefaults", () => {
  const previous: RunDefaults = { platform: "youtube", hashtags: ["#AI"] };

  it("swaps the hashtag set on titles already on screen", () => {
    const next: RunDefaults = { platform: "youtube", hashtags: ["#coding"] };
    expect(redraftWithDefaults(draft({ title: "Clip #AI" }), previous, next).title).toBe("Clip #coding");
  });

  it("keeps the caption already written", () => {
    const next: RunDefaults = { platform: "tiktok", hashtags: [] };
    expect(redraftWithDefaults(draft({ caption: "written by AI" }), previous, next).caption).toBe("written by AI");
  });

  it("moves a card that was still on the old default platform", () => {
    const next: RunDefaults = { platform: "tiktok", hashtags: ["#AI"] };
    const result = redraftWithDefaults(draft({ slotUtc: "2026-08-10T11:30:00.000Z" }), previous, next);
    expect(result.platform).toBe("tiktok");
    expect(result.slotUtc).toBe("");
  });

  it("never overrides a platform picked by hand on one card", () => {
    const next: RunDefaults = { platform: "tiktok", hashtags: ["#AI"] };
    const result = redraftWithDefaults(
      draft({ platform: "instagram", slotUtc: "2026-08-10T11:30:00.000Z" }),
      previous,
      next
    );
    expect(result.platform).toBe("instagram");
    expect(result.slotUtc).toBe("2026-08-10T11:30:00.000Z");
  });
});

describe("hydrateDraft", () => {
  const stored: PersistedDraft = {
    title: "Saved title #AI",
    caption: "Saved caption",
    platform: "tiktok",
    headline: "Original headline",
    updatedAt: Date.now()
  };

  it("restores the caption and target a reload would have thrown away", () => {
    const result = hydrateDraft(draft(), stored, "Original headline");
    expect(result.caption).toBe("Saved caption");
    expect(result.platform).toBe("tiktok");
    expect(result.title).toBe("Saved title #AI");
  });

  it("keeps the caption but drops a stale title when the clip was renamed elsewhere", () => {
    const result = hydrateDraft(draft({ title: "Renamed in the editor" }), stored, "Renamed in the editor");
    expect(result.title).toBe("Renamed in the editor");
    expect(result.caption).toBe("Saved caption");
  });

  it("leaves a clip with nothing saved exactly as the defaults made it", () => {
    const fresh = draft();
    expect(hydrateDraft(fresh, undefined, "Original headline")).toBe(fresh);
  });
});

describe("pruneDrafts", () => {
  it("drops entries older than the retention window and keeps recent ones", () => {
    const now = Date.parse("2026-08-06T12:00:00.000Z");
    const entry = (updatedAt: number): PersistedDraft => ({
      title: "t",
      caption: "c",
      platform: "youtube",
      headline: "h",
      updatedAt
    });
    const pruned = pruneDrafts(
      {
        fresh: entry(now - 1000),
        stale: entry(now - 61 * 24 * 60 * 60 * 1000)
      },
      now
    );
    expect(Object.keys(pruned)).toEqual(["fresh"]);
  });
});
