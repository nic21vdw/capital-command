import { describe, expect, it } from "vitest";
import { accountNotices, formatRate, sourceLabel, sparklinePoints, syncStatusLine } from "@/lib/analytics/view";
import type { AccountSync } from "@/lib/analytics/types";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const HOUR = 3_600_000;

describe("sparklinePoints", () => {
  it("scales a series into the box, highest point at the top", () => {
    expect(sparklinePoints([0, 5, 10], 100, 20)).toBe("0.0,20.0 50.0,10.0 100.0,0.0");
  });

  it("draws a flat series along the middle", () => {
    expect(sparklinePoints([4, 4, 4], 100, 20)).toBe("0.0,10.0 50.0,10.0 100.0,10.0");
  });

  it("has nothing to draw for fewer than two points", () => {
    expect(sparklinePoints([], 100, 20)).toBeNull();
    expect(sparklinePoints([3], 100, 20)).toBeNull();
  });
});

describe("formatRate", () => {
  it("shows a percentage to one place, and a dash when there is no rate", () => {
    expect(formatRate(0.0613)).toBe("6.1%");
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(null)).toBe("-");
  });
});

describe("syncStatusLine", () => {
  const base = { lastAttemptAt: null, lastCompletedAt: null, lastResult: null, lastError: null, running: false, nextDueAt: null };

  it("says so when nothing has synced", () => {
    expect(syncStatusLine(base, NOW)).toBe("Never synced yet");
  });

  it("says how long ago the last sync finished", () => {
    const done = { ...base, lastCompletedAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(), lastResult: "ok" as const };

    expect(syncStatusLine(done, NOW)).toBe("Synced 3 h ago");
  });

  it("says it is syncing, and names a failure", () => {
    expect(syncStatusLine({ ...base, running: true }, NOW)).toBe("Syncing now");
    expect(
      syncStatusLine({ ...base, lastResult: "error", lastError: "The Threads queue could not be read.", lastCompletedAt: null }, NOW)
    ).toBe("Last sync failed: The Threads queue could not be read.");
  });
});

describe("accountNotices", () => {
  function account(overrides: Partial<AccountSync>): AccountSync {
    return {
      key: "youtube:youtube-primary",
      platform: "youtube",
      accountId: "youtube-primary",
      label: null,
      status: "ok",
      note: null,
      at: NOW.toISOString(),
      posts: 0,
      ...overrides
    };
  }

  it("lists only the accounts that need something, with what to do", () => {
    const notices = accountNotices(
      [
        account({}),
        account({ key: "threads:primary", platform: "threads", accountId: "primary", label: "nic", status: "paused-auth", note: "Session has expired" }),
        account({ key: "tiktok:tiktok-primary", platform: "tiktok", accountId: "tiktok-primary", status: "unsupported", note: "TikTok needs video.list." }),
        account({
          key: "instagram:instagram-primary",
          platform: "instagram",
          accountId: "instagram-primary",
          status: "rate-limited",
          backoffUntil: new Date(NOW.getTime() + 2 * HOUR).toISOString()
        }),
        account({ key: "youtube:other", accountId: "other", status: "ok", note: "Watch time needs the yt-analytics.readonly scope." })
      ],
      NOW
    );

    expect(notices.map((notice) => notice.text)).toEqual([
      "Threads · nic needs reconnecting: Session has expired",
      "TikTok: TikTok needs video.list.",
      "Instagram is rate limited; trying again in 2 h",
      "YouTube: Watch time needs the yt-analytics.readonly scope."
    ]);
    expect(notices[0].tone).toBe("danger");
    expect(notices[1].tone).toBe("info");
    expect(notices[2].tone).toBe("warning");
  });

  it("is empty when everything reads fine", () => {
    expect(accountNotices([account({})], NOW)).toEqual([]);
  });
});

describe("sourceLabel", () => {
  it("names where the numbers came from, in words", () => {
    expect(sourceLabel("youtube-analytics")).toBe("YouTube Analytics");
    expect(sourceLabel("youtube-data-api")).toBe("YouTube Data API");
    expect(sourceLabel("instagram-insights")).toBe("Instagram insights");
    expect(sourceLabel("instagram-basic")).toBe("Likes and comments only");
    expect(sourceLabel("facebook-basic")).toBe("Reactions and comments only");
    expect(sourceLabel(null)).toBe("");
  });
});
