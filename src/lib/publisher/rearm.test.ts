import { describe, expect, it } from "vitest";
import { primaryAccountId } from "@/lib/publisher/accounts";
import { hasRearmablePlatform, rearmItem, rearmItems } from "@/lib/publisher/rearm";
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
});
