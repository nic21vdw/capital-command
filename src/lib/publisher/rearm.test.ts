import { describe, expect, it, vi } from "vitest";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { connectRearmScope, hasRearmablePlatform, rearmItem, rearmItems } from "@/lib/publisher/rearm";
import { YOUTUBE_RECONNECT_REQUIRED } from "@/lib/publisher/googleAuth";
import { testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

function blocked(overrides: Partial<QueueItem> = {}): QueueItem {
  const item = testItem({ platformIds: ["youtube", "tiktok"], ...overrides });
  item.platforms.youtube = { status: "manual", attempts: 0, note: "YouTube isn't connected yet." };
  item.platforms.tiktok = { status: "failed", attempts: 3, error: "reconnect TikTok", nextAttemptAt: "2026-07-11T00:00:00.000Z" };
  return item;
}

describe("re-arming blocked posts", () => {
  it("puts manual and failed platforms back to pending with a clean slate", () => {
    const item = blocked({ failedSeenAt: "2026-07-11T00:00:00.000Z" });

    expect(rearmItem(item).sort()).toEqual(["tiktok", "youtube"]);
    expect(item.platforms.youtube).toEqual({ status: "pending", attempts: 0 });
    expect(item.platforms.tiktok).toEqual({ status: "pending", attempts: 0 });
    expect(item.failedSeenAt).toBeUndefined();
  });

  it("leaves published, scheduled and pending platforms alone", () => {
    const item = testItem({ platformIds: ["youtube", "tiktok", "instagram"] });
    item.platforms.youtube = { status: "published", attempts: 1, postId: "vid1" };
    item.platforms.tiktok = { status: "scheduled", attempts: 1, postId: "tt1" };

    expect(rearmItem(item)).toEqual([]);
    expect(item.platforms.youtube?.status).toBe("published");
    expect(item.platforms.tiktok?.status).toBe("scheduled");
  });

  it("turns LinkedIn's post-attempt marker into a re-armed one, keeping the media it uploaded", () => {
    const item = testItem({ platformIds: ["linkedin"] });
    item.platforms.linkedin = {
      status: "failed",
      attempts: 1,
      containerId: "posting:urn:li:document:DOC1",
      error: "May already be posted. Check the LinkedIn feed, then re-arm to post again"
    };

    expect(rearmItem(item, { platform: "linkedin" })).toEqual(["linkedin"]);
    expect(item.platforms.linkedin).toEqual({ status: "pending", attempts: 0, containerId: "rearmed:urn:li:document:DOC1" });
  });

  it("does not revive an ambiguous LinkedIn create when a reconnect re-arms connection failures", () => {
    const item = testItem({ platformIds: ["linkedin"] });
    item.platforms.linkedin = {
      status: "failed",
      attempts: 1,
      containerId: "posting:urn:li:document:DOC1",
      error: "May already be posted. Check the LinkedIn feed, then re-arm to post again"
    };

    expect(rearmItem(item, connectRearmScope("linkedin"))).toEqual([]);
    expect(item.platforms.linkedin?.containerId).toBe("posting:urn:li:document:DOC1");
  });

  it("scopes to one platform", () => {
    const item = blocked();

    expect(rearmItem(item, { platform: "tiktok" })).toEqual(["tiktok"]);
    expect(item.platforms.youtube?.status).toBe("manual");
  });

  it("scopes to one status, so a connect can revive only the manual reminders", () => {
    const item = blocked();

    expect(rearmItem(item, { statuses: ["manual"] })).toEqual(["youtube"]);
    expect(item.platforms.tiktok?.status).toBe("failed");
  });

  it("scopes to the account being reconnected", () => {
    const mine = blocked({ id: "mine", accountId: primaryAccountId("tiktok") });
    const other = blocked({ id: "other", accountId: "tiktok-second" });

    const changed = rearmItems([mine, other], { platform: "tiktok", accountId: "tiktok-second" });
    expect(changed.map((entry) => entry.item.id)).toEqual(["other"]);
    expect(mine.platforms.tiktok?.status).toBe("failed");
    expect(other.platforms.tiktok?.status).toBe("pending");
  });

  it("honours a reason filter, so unrelated permanent failures stay failed", () => {
    const item = blocked();

    const revived = rearmItem(item, {
      statuses: ["failed"],
      where: (state) => Boolean(state.error?.includes("reconnect"))
    });
    expect(revived).toEqual(["tiktok"]);

    item.platforms.tiktok = { status: "failed", attempts: 3, error: "video too long" };
    expect(
      rearmItem(item, { statuses: ["failed"], where: (state) => Boolean(state.error?.includes("reconnect")) })
    ).toEqual([]);
    expect(item.platforms.tiktok?.status).toBe("failed");
  });

  it("reports whether anything on a post could be retried", () => {
    expect(hasRearmablePlatform(blocked())).toBe(true);
    expect(hasRearmablePlatform(testItem())).toBe(false);
  });

  it("keeps the post id, because that is what stops a retry uploading a second copy", () => {
    const item = testItem({ platformIds: ["youtube"] });
    item.platforms.youtube = { status: "failed", attempts: 1, postId: "vid1", error: "went private" };

    expect(rearmItem(item)).toEqual(["youtube"]);
    expect(item.platforms.youtube?.postId).toBe("vid1");
  });
});

describe("what a reconnect re-arms", () => {
  it("revives only the connection-blocked posts of that account", () => {
    const revoked = testItem({ id: "revoked", platformIds: ["youtube"] });
    revoked.platforms.youtube = { status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED };
    const rejected = testItem({ id: "rejected", platformIds: ["youtube"] });
    rejected.platforms.youtube = { status: "failed", attempts: 3, error: "The video was rejected as a duplicate." };
    const waiting = testItem({ id: "waiting", platformIds: ["youtube"] });
    waiting.platforms.youtube = { status: "manual", attempts: 0, note: "YouTube isn't connected yet." };
    const otherAccount = testItem({ id: "other-account", platformIds: ["youtube"], accountId: "youtube-second" });
    otherAccount.platforms.youtube = { status: "failed", attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED };

    const changed = rearmItems(
      [revoked, rejected, waiting, otherAccount],
      connectRearmScope("youtube", primaryAccountId("youtube"))
    );

    expect(changed.map((entry) => entry.item.id).sort()).toEqual(["revoked", "waiting"]);
    expect(rejected.platforms.youtube?.status).toBe("failed");
    expect(otherAccount.platforms.youtube?.status).toBe("failed");
    expect(waiting.platforms.youtube?.note).toBeUndefined();
  });
});

describe("re-arming with a slot-age limit (the board's bulk retry)", () => {
  const NOW = new Date("2026-10-10T12:00:00.000Z");
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
  const failedItem = (id: string, publishAt: string, status: "failed" | "manual" = "failed") => {
    const item = testItem({ id, platformIds: ["youtube"], publishAt });
    item.platforms.youtube =
      status === "failed"
        ? { status, attempts: 3, error: YOUTUBE_RECONNECT_REQUIRED }
        : { status, attempts: 0, note: "YouTube isn't connected yet." };
    return item;
  };

  it("revives only failed legs when asked, leaving a manual reminder as it was", () => {
    const failed = failedItem("failed", hoursAgo(1));
    const manual = failedItem("manual", hoursAgo(1), "manual");

    const changed = rearmItems([failed, manual], connectRearmScope("youtube", undefined, { statuses: ["failed"], now: NOW }));

    expect(changed.map((entry) => entry.item.id)).toEqual(["failed"]);
    expect(manual.platforms.youtube?.status).toBe("manual");
  });

  it("still revives both by default, which the Google callback relies on", () => {
    const manual = failedItem("manual", hoursAgo(100), "manual");
    const old = failedItem("old", hoursAgo(100));

    expect(rearmItems([manual, old], connectRearmScope("youtube", primaryAccountId("youtube"))).length).toBe(2);
  });

  it("leaves a failure whose slot is more than the limit in the past, and reports it", () => {
    const recent = failedItem("recent", hoursAgo(23));
    const stale = failedItem("stale", hoursAgo(25));
    const upcoming = failedItem("upcoming", new Date(NOW.getTime() + 3_600_000).toISOString());
    const skipped: string[] = [];

    const changed = rearmItems(
      [recent, stale, upcoming],
      connectRearmScope("youtube", undefined, {
        statuses: ["failed"],
        maxSlotAgeMs: 24 * 3_600_000,
        now: NOW,
        onSkipped: (item) => skipped.push(item.id)
      })
    );

    expect(changed.map((entry) => entry.item.id).sort()).toEqual(["recent", "upcoming"]);
    expect(skipped).toEqual(["stale"]);
    expect(stale.platforms.youtube?.status).toBe("failed");
  });

  it("does not count a stale leg that the connection filter would have skipped anyway", () => {
    const rejected = failedItem("rejected", hoursAgo(100));
    rejected.platforms.youtube = { status: "failed", attempts: 3, error: "The video was rejected as a duplicate." };
    const onSkipped = vi.fn();

    rearmItems([rejected], connectRearmScope("youtube", undefined, { maxSlotAgeMs: 3_600_000, now: NOW, onSkipped }));

    expect(onSkipped).not.toHaveBeenCalled();
  });
});
