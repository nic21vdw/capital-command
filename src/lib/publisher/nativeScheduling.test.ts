import { describe, expect, it } from "vitest";
import {
  facebookLead,
  isTiktokInboxDraft,
  pendingHint,
  pendingLabel,
  preSchedules,
  preSchedulesItem,
  TIKTOK_INBOX_CHIP,
  manualLabel,
  OVERDUE_HINT,
  OVERDUE_LABEL,
  pastSlotMarker,
  shouldBeLiveHint,
  waitingForConnectionHint,
  waitingForConnectionLabel
} from "@/lib/publisher/nativeScheduling";

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

  // Every slot here is measured from the frozen `now` above, so every reader of
  // one has to be given that same `now`. The two that were not - a label and a
  // hint - were answered against the real clock instead, and passed only while
  // the real clock was still behind a fixture dated 2026-08-26.
  it("hands a picture post over early on the same window as a Reel", () => {
    expect(preSchedulesItem("facebook", deck(at(7 * 24 * 60 * 60_000)), now)).toBe(true);
    expect(pendingLabel("facebook", deck(at(7 * 24 * 60 * 60_000)), now)).toBe("Uploading");
    expect(preSchedulesItem("facebook", deck(at(5 * 60_000)), now)).toBe(false);
    expect(preSchedulesItem("facebook", deck(at(60 * 24 * 60 * 60_000)), now)).toBe(false);
    expect(pendingHint("facebook", deck(at(60 * 24 * 60 * 60_000)), now)).toContain("29 days");
  });

  // The window has two edges and only one of them is "too far". A post that is
  // imminent or overdue is not pre-scheduled either, and it used to be told the
  // slot was further out than Facebook would hold it.
  it("does not tell an overdue post that it is too far in the future", () => {
    expect(pendingHint("facebook", deck(at(-60_000)), now)).not.toContain("29 days");
    expect(pendingHint("facebook", deck(at(5 * 60_000)), now)).not.toContain("29 days");
    expect(pendingHint("facebook", deck(at(5 * 60_000)), now)).toContain("no scheduling API");
    expect(pendingHint("facebook", deck(at(60 * 24 * 60 * 60_000)), now)).toContain("29 days");
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

describe("TikTok delivered to the inbox", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const publishAt = new Date(now.getTime() + 3 * 24 * 60 * 60_000).toISOString();
  const inbox = { publishAt, tiktok: { delivery: "inbox" as const } };
  const direct = { publishAt, tiktok: { delivery: "direct" as const } };

  it("does not say nothing else is needed when the last step is a tap in the TikTok app", () => {
    expect(pendingHint("tiktok", inbox, now)).toContain("finish the post in the TikTok app");
    expect(pendingHint("tiktok", inbox, now)).not.toContain("Nothing else is needed");
    expect(pendingLabel("tiktok", inbox, now)).toBe("To inbox at slot");
  });

  it("treats a post with no recorded delivery as the inbox, which is the default", () => {
    expect(pendingHint("tiktok", { publishAt }, now)).toContain("TikTok inbox");
  });

  it("keeps the plain wording for a direct post, which really does need nothing else", () => {
    expect(pendingHint("tiktok", direct, now)).toContain("Nothing else is needed");
    expect(pendingLabel("tiktok", direct, now)).toBe("Posts at slot");
  });

  it("recognises a recorded 'scheduled' as an unfinished draft only for inbox delivery", () => {
    expect(isTiktokInboxDraft("tiktok", "scheduled", inbox)).toBe(true);
    expect(isTiktokInboxDraft("tiktok", "scheduled", direct)).toBe(false);
    expect(isTiktokInboxDraft("tiktok", "published", inbox)).toBe(false);
    expect(isTiktokInboxDraft("youtube", "scheduled", inbox)).toBe(false);
    expect(isTiktokInboxDraft("tiktok", "scheduled", undefined)).toBe(false);
    expect(TIKTOK_INBOX_CHIP).toContain("inbox");
  });
});

describe("a YouTube post held back by the daily upload limit", () => {
  it("says it is waiting for the quota instead of 'Uploading' and 'it goes up now'", () => {
    expect(pendingLabel("youtube", undefined, undefined, { youtubeQuotaFull: true })).toBe("Waiting for quota");
    const hint = pendingHint("youtube", undefined, undefined, { youtubeQuotaFull: true });
    expect(hint).toContain("quota resets");
    expect(hint).not.toContain("goes up now");
  });

  it("changes nothing for the other platforms or when the allowance is not spent", () => {
    expect(pendingLabel("youtube")).toBe("Uploading");
    expect(pendingLabel("instagram", undefined, undefined, { youtubeQuotaFull: true })).toBe("Posts at slot");
  });
});

describe("a pending leg whose account is not connected", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const future = { publishAt: "2026-10-14T11:30:00.000Z" };

  it("is waiting for the connection, never 'Uploading' or 'Posts at slot'", () => {
    expect(pendingLabel("youtube", future, now, { connected: false })).toBe("Needs YouTube connection");
    expect(pendingLabel("instagram", future, now, { connected: false })).toBe("Needs Instagram connection");
    expect(pendingLabel("tiktok", { ...future, tiktok: { delivery: "inbox" } }, now, { connected: false })).toBe(
      "Needs TikTok connection"
    );
    expect(pendingLabel("youtube", future, now, { connected: true })).toBe("Uploading");
    expect(pendingLabel("youtube", future, now, {})).toBe("Uploading");
  });

  it("wins over the quota wait: nothing uploads before it is connected", () => {
    expect(pendingLabel("youtube", future, now, { connected: false, youtubeQuotaFull: true })).toBe(
      "Needs YouTube connection"
    );
  });

  it("explains the way out", () => {
    expect(pendingHint("youtube", future, now, { connected: false })).toBe(waitingForConnectionHint("youtube"));
    expect(waitingForConnectionHint("youtube")).toBe(
      "Waiting for YouTube - connect to post automatically, or post by hand at its slot."
    );
    expect(waitingForConnectionHint("tiktok", "Tue, Oct 14, 7:30 AM")).toBe(
      "Waiting for TikTok - connect to post automatically, or post by hand at Tue, Oct 14, 7:30 AM."
    );
    expect(waitingForConnectionLabel("facebook")).toBe("Needs Facebook connection");
  });

  it("names the slot in the hint when the board can write it", () => {
    expect(pendingHint("youtube", future, now, { connected: false, formatSlot: () => "Tue, Oct 14, 7:30 AM" })).toBe(
      "Waiting for YouTube - connect to post automatically, or post by hand at Tue, Oct 14, 7:30 AM."
    );
  });
});

describe("a manual reminder on a chip", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const ahead = "2026-10-14T11:30:00.000Z";
  const behind = "2026-10-10T11:30:00.000Z";

  it("reads the same as a pending leg before its slot: it needs the connection", () => {
    expect(manualLabel("youtube", ahead, now, false)).toBe("Needs YouTube connection");
    expect(manualLabel("youtube", ahead, now)).toBe(pendingLabel("youtube", { publishAt: ahead }, now, { connected: false }));
  });

  it("is a miss after its slot, in the one phrase that says what is left to do", () => {
    expect(manualLabel("tiktok", behind, now, false)).toBe("Post by hand");
  });

  it("points at Retry once something has been connected, and never says Manual", () => {
    expect(manualLabel("tiktok", ahead, now, true)).toBe("Retry to post");
    for (const label of [
      manualLabel(undefined, undefined),
      manualLabel("youtube", ahead, now),
      manualLabel("youtube", behind, now),
      manualLabel("youtube", ahead, now, true)
    ]) {
      expect(label).not.toMatch(/manual/i);
    }
  });
});

describe("a post whose slot has passed without going out", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const behind = { publishAt: "2026-10-10T11:30:00.000Z", format: "short" as const };
  const justPassed = { publishAt: "2026-10-11T11:55:00.000Z", format: "short" as const };
  const ahead = { publishAt: "2026-10-14T11:30:00.000Z", format: "short" as const };

  it("is Overdue, pointing at Automations, when a post the app sends itself is still pending", () => {
    for (const platform of ["instagram", "tiktok", "facebook"] as const) {
      expect(pendingLabel(platform, behind, now)).toBe(OVERDUE_LABEL);
      expect(pendingHint(platform, behind, now)).toBe(OVERDUE_HINT);
    }
    expect(OVERDUE_HINT).toBe("Its slot passed and the publisher hasn't sent it yet - check Automations");
    const marker = pastSlotMarker("instagram", { status: "pending" }, behind, now);
    expect(marker).toMatchObject({ kind: "overdue", label: "Overdue", href: "/automations" });
  });

  it("is Overdue for a YouTube upload that never happened, too: nothing is on YouTube to publish it", () => {
    expect(pendingLabel("youtube", behind, now)).toBe(OVERDUE_LABEL);
    expect(pastSlotMarker("youtube", { status: "pending" }, behind, now)?.kind).toBe("overdue");
  });

  it("leaves a slot still to come, or one that only just passed, as it was", () => {
    expect(pendingLabel("instagram", ahead, now)).toBe("Posts at slot");
    expect(pendingLabel("instagram", justPassed, now)).toBe("Posts at slot");
    expect(pastSlotMarker("instagram", { status: "pending" }, ahead, now)).toBeNull();
    expect(pastSlotMarker("instagram", { status: "pending" }, justPassed, now)).toBeNull();
  });

  it("stays quiet while something else explains the wait: no connection, the quota, a claim in progress", () => {
    expect(pendingLabel("instagram", behind, now, { connected: false })).toBe("Needs Instagram connection");
    expect(pendingLabel("youtube", behind, now, { youtubeQuotaFull: true })).toBe("Waiting for quota");
    expect(pastSlotMarker("instagram", { status: "pending" }, behind, now, { connected: false })).toBeNull();
    expect(pastSlotMarker("youtube", { status: "pending" }, behind, now, { youtubeQuotaFull: true })).toBeNull();
    const claimed = { status: "pending" as const, claimedAt: "2026-10-11T11:58:00.000Z" };
    expect(pastSlotMarker("instagram", claimed, behind, now)).toBeNull();
    expect(pendingLabel("instagram", behind, now, { inFlight: true })).toBe("Posts at slot");
    // A claim that was never released (a crashed runner) does not hide the problem.
    const stale = { status: "pending" as const, claimedAt: "2026-10-11T09:00:00.000Z" };
    expect(pastSlotMarker("instagram", stale, behind, now)?.kind).toBe("overdue");
  });

  it("says a scheduled YouTube post should be live, never Overdue", () => {
    const marker = pastSlotMarker("youtube", { status: "scheduled", postId: "abc123" }, behind, now);
    expect(marker).toMatchObject({ kind: "should-be-live", label: "Should be live", hint: "Its slot passed - YouTube should have published it by now." });
    expect(shouldBeLiveHint("youtube")).toBe("Its slot passed - YouTube should have published it by now.");
    // The chip says "Should be live" and the button says "Check YouTube": the line repeats neither.
    expect(marker?.hint).not.toContain(marker?.label);
    expect(marker?.hint).not.toContain(marker?.linkLabel);
    expect(marker?.label).not.toBe(OVERDUE_LABEL);
  });

  it("says the same of a Facebook post Facebook is holding", () => {
    expect(pastSlotMarker("facebook", { status: "scheduled", postId: "123" }, behind, now)?.hint).toBe(
      "Its slot passed - Facebook should have published it by now."
    );
  });

  it("marks nothing that is not waiting on the platform or the publisher", () => {
    // Not yet at the slot.
    expect(pastSlotMarker("youtube", { status: "scheduled", postId: "abc" }, ahead, now)).toBeNull();
    // No video id: there is nothing to check.
    expect(pastSlotMarker("youtube", { status: "scheduled" }, behind, now)).toBeNull();
    // A long-form upload is held private for review on purpose.
    expect(pastSlotMarker("youtube", { status: "scheduled", postId: "abc" }, { ...behind, format: "long" }, now)).toBeNull();
    // The other statuses already say what they are.
    for (const status of ["published", "failed", "manual", "uploaded"] as const) {
      expect(pastSlotMarker("youtube", { status, postId: "abc" }, behind, now)).toBeNull();
    }
    // Instagram/TikTok "scheduled" (an inbox draft) is finished in the app, not overdue.
    expect(pastSlotMarker("tiktok", { status: "scheduled", postId: "p" }, behind, now)).toBeNull();
  });
});
