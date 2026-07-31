import { describe, expect, it } from "vitest";
import {
  applyRevision,
  applySkip,
  isMovable,
  lockedPlatforms,
  openPlatforms,
  reviseRefusal,
  shiftDay,
  skipRefusal
} from "@/lib/publisher/revise";
import { isTerminalStatus } from "@/lib/publisher/queue";
import type { PlatformId, PlatformState, PlatformStatus, QueueItem } from "@/lib/publisher/types";

const TZ = "America/Toronto";

function state(status: PlatformStatus, extra: Partial<PlatformState> = {}): PlatformState {
  return { status, attempts: 0, ...extra };
}

function item(
  platforms: Partial<Record<PlatformId, PlatformState>>,
  overrides: Partial<QueueItem> = {}
): QueueItem {
  return {
    id: "q1",
    clipPath: "data/clips/a.mp4",
    title: "A clip",
    caption: "caption",
    hashtags: ["#ai"],
    // 2026-07-30 14:00 in Toronto (UTC-4).
    publishAt: "2026-07-30T18:00:00.000Z",
    visibility: "public",
    createdAt: "2026-07-01T00:00:00.000Z",
    platforms,
    ...overrides
  };
}

describe("locked vs open platforms", () => {
  it("locks exactly the states where the platform already has the post", () => {
    const target = item({
      youtube: state("published"),
      instagram: state("uploaded"),
      tiktok: state("pending"),
      facebook: state("failed")
    });
    expect(lockedPlatforms(target)).toEqual(["youtube", "instagram"]);
    expect(openPlatforms(target)).toEqual(["tiktok", "facebook"]);
  });

  it("treats a natively-scheduled YouTube post as gone, not as ours", () => {
    expect(lockedPlatforms(item({ youtube: state("scheduled") }))).toEqual(["youtube"]);
  });

  it("leaves manual reminders and skipped posts editable", () => {
    expect(openPlatforms(item({ tiktok: state("manual"), facebook: state("skipped") }))).toEqual([
      "tiktok",
      "facebook"
    ]);
  });
});

describe("reviseRefusal", () => {
  const open = item({ youtube: state("pending"), tiktok: state("pending") });

  it("allows delivery changes while everything is still ours", () => {
    expect(reviseRefusal(open, { publishAt: "2026-07-31T18:00:00.000Z" })).toBeNull();
    expect(reviseRefusal(open, { caption: "new", visibility: "private" })).toBeNull();
  });

  it("refuses a delivery change once any platform has it, naming them", () => {
    const gone = item({ youtube: state("published"), tiktok: state("uploaded") });
    const refusal = reviseRefusal(gone, { publishAt: "2026-07-31T18:00:00.000Z" });
    expect(refusal).toContain("YouTube and TikTok");
    expect(refusal).toContain("only its title can change");
  });

  it("still allows a rename after the post is live", () => {
    const gone = item({ youtube: state("published") });
    expect(reviseRefusal(gone, { title: "Renamed" })).toBeNull();
  });

  it("rejects an empty title and an unparseable time", () => {
    expect(reviseRefusal(open, { title: "   " })).toBe("A post needs a title.");
    expect(reviseRefusal(open, { publishAt: "not a date" })).toBe("That isn't a valid publish time.");
  });

  it("will not leave a post with nowhere to go", () => {
    expect(reviseRefusal(open, { platforms: [] })).toContain("at least one platform");
  });

  it("refuses to drop a platform that already has the post", () => {
    const half = item({ youtube: state("published"), tiktok: state("pending") });
    expect(reviseRefusal(half, { platforms: ["tiktok"] })).toContain("YouTube already has this post");
  });

  it("allows dropping a platform that has not posted yet", () => {
    expect(reviseRefusal(open, { platforms: ["youtube"] })).toBeNull();
  });

  it("keeps enqueue's rule that an account only takes its own platform", () => {
    const refusal = reviseRefusal(open, { accountId: "yt-2" }, { accountPlatform: "youtube" });
    expect(refusal).toContain("TikTok");
  });

  it("accepts an account matching the post's only platform", () => {
    const youtubeOnly = item({ youtube: state("pending") });
    expect(reviseRefusal(youtubeOnly, { accountId: "yt-2" }, { accountPlatform: "youtube" })).toBeNull();
  });
});

describe("applyRevision", () => {
  it("does not mutate the item it was given", () => {
    const original = item({ youtube: state("pending") });
    applyRevision(original, { title: "Changed", publishAt: "2026-08-01T18:00:00.000Z" });
    expect(original.title).toBe("A clip");
    expect(original.publishAt).toBe("2026-07-30T18:00:00.000Z");
  });

  it("clears the retry gate and the claim when the time moves", () => {
    const backedOff = item({
      youtube: state("failed", { nextAttemptAt: "2026-07-30T19:00:00.000Z", claimedAt: "2026-07-30T18:00:00.000Z" })
    });
    const next = applyRevision(backedOff, { publishAt: "2026-08-01T18:00:00.000Z" });
    expect(next.platforms.youtube?.nextAttemptAt).toBeUndefined();
    expect(next.platforms.youtube?.claimedAt).toBeUndefined();
    expect(next.platforms.youtube?.status).toBe("failed");
  });

  it("adds a new platform as pending when it is connected", () => {
    const next = applyRevision(
      item({ youtube: state("pending") }),
      { platforms: ["youtube", "tiktok"] },
      { configured: ["youtube", "tiktok"] }
    );
    expect(next.platforms.tiktok?.status).toBe("pending");
  });

  it("adds an unconnected platform as a manual reminder, like enqueue does", () => {
    const next = applyRevision(
      item({ youtube: state("pending") }),
      { platforms: ["youtube", "tiktok"] },
      { configured: ["youtube"] }
    );
    expect(next.platforms.tiktok?.status).toBe("manual");
    expect(next.platforms.tiktok?.note).toContain("by hand");
  });

  it("drops a removed platform entirely", () => {
    const next = applyRevision(item({ youtube: state("pending"), tiktok: state("pending") }), {
      platforms: ["youtube"]
    });
    expect(next.platforms.tiktok).toBeUndefined();
  });

  it("leaves a locked platform's gates alone when only the title changes", () => {
    const live = item({ youtube: state("published", { publishedAt: "2026-07-30T18:01:00.000Z" }) });
    const next = applyRevision(live, { title: "Renamed" });
    expect(next.platforms.youtube?.publishedAt).toBe("2026-07-30T18:01:00.000Z");
    expect(next.title).toBe("Renamed");
  });
});

describe("skip", () => {
  it("is terminal for the runner", () => {
    expect(isTerminalStatus("skipped")).toBe(true);
  });

  it("marks every open platform skipped and keeps the record", () => {
    const next = applySkip(item({ youtube: state("pending"), tiktok: state("failed") }));
    expect(next.platforms.youtube?.status).toBe("skipped");
    expect(next.platforms.tiktok?.status).toBe("skipped");
    expect(next.platforms.youtube?.note).toContain("not post");
  });

  it("leaves a platform that already published untouched", () => {
    const next = applySkip(item({ youtube: state("published"), tiktok: state("pending") }));
    expect(next.platforms.youtube?.status).toBe("published");
    expect(next.platforms.tiktok?.status).toBe("skipped");
  });

  it("can skip one named platform without touching the others", () => {
    const next = applySkip(item({ youtube: state("pending"), tiktok: state("pending") }), ["tiktok"]);
    expect(next.platforms.youtube?.status).toBe("pending");
    expect(next.platforms.tiktok?.status).toBe("skipped");
  });

  it("refuses when there is nothing left to skip", () => {
    expect(skipRefusal(item({ youtube: state("published") }))).toContain("nothing left to skip");
  });

  it("refuses to skip a platform that has already gone out", () => {
    const half = item({ youtube: state("published"), tiktok: state("pending") });
    expect(skipRefusal(half, ["youtube"])).toContain("isn't waiting to post");
  });
});

describe("shiftDay", () => {
  const monday = item({ youtube: state("pending") }, { id: "a", publishAt: "2026-07-30T18:00:00.000Z" });
  const alsoMonday = item({ tiktok: state("pending") }, { id: "b", publishAt: "2026-07-30T23:30:00.000Z" });
  const tuesday = item({ youtube: state("pending") }, { id: "c", publishAt: "2026-07-31T18:00:00.000Z" });

  it("moves only the posts on that local day", () => {
    const { moved } = shiftDay([monday, alsoMonday, tuesday], "2026-07-30", 60, TZ);
    expect(moved.map((i) => i.id)).toEqual(["a", "b"]);
    expect(moved[0].publishAt).toBe("2026-07-30T19:00:00.000Z");
  });

  it("moves backwards on a negative shift", () => {
    const { moved } = shiftDay([monday], "2026-07-30", -30, TZ);
    expect(moved[0].publishAt).toBe("2026-07-30T17:30:00.000Z");
  });

  it("reports what it could not move instead of moving it silently", () => {
    const live = item({ youtube: state("published") }, { id: "d", publishAt: "2026-07-30T20:00:00.000Z" });
    const { moved, blocked } = shiftDay([monday, live], "2026-07-30", 60, TZ);
    expect(moved.map((i) => i.id)).toEqual(["a"]);
    expect(blocked).toEqual([{ id: "d", title: "A clip", reason: "already on YouTube" }]);
  });

  it("offers the day control on exactly the posts it would move", () => {
    // A day whose slots have all passed can still hold a movable post — the
    // control keys off this, not off the day's "no slots left" flag.
    expect(isMovable(monday)).toBe(true);
    expect(isMovable(item({ youtube: state("published") }))).toBe(false);
    expect(isMovable(item({ youtube: state("skipped") }))).toBe(false);
    expect(isMovable(item({ youtube: state("skipped"), tiktok: state("pending") }))).toBe(true);
    expect(isMovable(item({}))).toBe(false);
  });

  it("does not resurrect a skipped post", () => {
    const skipped = item({ youtube: state("skipped") }, { id: "e", publishAt: "2026-07-30T20:00:00.000Z" });
    const { moved, blocked } = shiftDay([skipped], "2026-07-30", 60, TZ);
    expect(moved).toHaveLength(0);
    expect(blocked[0].reason).toBe("skipped");
  });

  it("uses the publish timezone, not UTC, to decide which day a post is on", () => {
    // 01:30Z on the 31st is still 21:30 on the 30th in Toronto.
    const lateNight = item({ youtube: state("pending") }, { id: "f", publishAt: "2026-07-31T01:30:00.000Z" });
    expect(shiftDay([lateNight], "2026-07-30", 15, TZ).moved.map((i) => i.id)).toEqual(["f"]);
    expect(shiftDay([lateNight], "2026-07-31", 15, TZ).moved).toHaveLength(0);
  });
});
