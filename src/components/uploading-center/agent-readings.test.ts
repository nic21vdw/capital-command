import { describe, expect, it } from "vitest";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";
import type { PlatformState, QueueItem } from "@/lib/publisher/types";
import { backupReading, brokenAccountsReading, queueStatusReadings, quotaReadings } from "./agent-readings";

const NOW = new Date("2026-10-14T15:00:00.000Z");
const TZ = "America/Toronto";

function leg(status: PlatformState["status"]): PlatformState {
  return { status, attempts: 0 };
}

function item(id: string, publishAt: string, platforms: QueueItem["platforms"]): QueueItem {
  return { id, clipPath: `data/${id}.mp4`, title: id, caption: "", hashtags: [], publishAt, visibility: "public", createdAt: "2026-10-01T00:00:00.000Z", platforms };
}

const QUEUE: QueueItem[] = [
  item("a", "2026-10-15T22:00:00.000Z", { youtube: leg("scheduled"), instagram: leg("pending") }),
  item("b", "2026-10-16T22:00:00.000Z", { youtube: leg("scheduled") }),
  item("c", "2026-10-12T22:00:00.000Z", { youtube: leg("published"), tiktok: leg("failed") }),
  item("d", "2026-10-17T22:00:00.000Z", { tiktok: leg("manual"), facebook: leg("uploaded") }),
  item("e", "2026-10-13T22:00:00.000Z", { instagram: leg("pending") })
];

describe("queueStatusReadings", () => {
  const readings = queueStatusReadings(QUEUE, NOW, TZ);
  const value = (label: string) => readings.find((reading) => reading.label === label)?.value ?? "";

  it("gives one reading per platform, in a fixed order, even for a platform with nothing queued", () => {
    expect(readings.map((reading) => reading.label)).toEqual(["Queue: YouTube", "Queue: Instagram", "Queue: TikTok", "Queue: Facebook"]);
    expect(queueStatusReadings([], NOW, TZ).map((reading) => reading.value)).toEqual(Array(4).fill("Nothing queued."));
  });

  it("counts pending, scheduled and failed per platform and ignores what already published", () => {
    expect(value("Queue: YouTube")).toMatch(/^0 pending, 2 scheduled, 0 failed;/);
    expect(value("Queue: TikTok")).toMatch(/^0 pending, 0 scheduled, 1 failed, 1 manual;/);
  });

  it("counts an uploaded leg as pending, since it is not live yet", () => {
    expect(value("Queue: Facebook")).toMatch(/^1 pending,/);
  });

  it("names the next slot in the publish timezone and ignores a slot already past", () => {
    expect(value("Queue: YouTube")).toMatch(/next slot Oct 15, 6:00\sPM \(America\/Toronto\)\.$/);
    expect(value("Queue: Instagram")).toMatch(/next slot Oct 15, 6:00\sPM/);
  });

  it("reports an overdue pending post as overdue rather than as the next slot", () => {
    expect(value("Queue: Instagram")).toContain("1 overdue");
  });

  it("says when nothing is coming up", () => {
    const only = queueStatusReadings([item("z", "2026-10-12T22:00:00.000Z", { youtube: leg("failed") })], NOW, TZ);
    expect(only[0].value).toBe("0 pending, 0 scheduled, 1 failed; no upcoming slot.");
  });
});

describe("brokenAccountsReading", () => {
  const broken: PlatformHealthResponse = {
    ok: false,
    checkedAt: "2026-10-14T14:59:00.000Z",
    broken: [
      {
        platform: "threads",
        accountId: "main",
        label: "main",
        displayName: "Threads · main",
        since: "2026-10-12T10:00:00.000Z",
        lastFailureAt: "2026-10-14T10:00:00.000Z",
        reason: "Session has expired",
        fixUrl: "/settings#accounts",
        failures: 4
      }
    ]
  };

  it("says it has not checked yet before the first answer", () => {
    expect(brokenAccountsReading(null)).toEqual({ label: "Broken accounts", value: "Not checked yet." });
  });

  it("says none when the health check finds nothing broken", () => {
    expect(brokenAccountsReading({ ok: true, checkedAt: broken.checkedAt, broken: [] })).toEqual({ label: "Broken accounts", value: "None." });
  });

  it("names each broken account, why, since when and where to fix it", () => {
    const reading = brokenAccountsReading(broken);
    expect(reading.label).toBe("Broken accounts");
    expect(reading.value).toBe("Threads · main: Session has expired (since 2026-10-12, 4 failures). Reconnect at /settings#accounts.");
  });

  it("separates several accounts and keeps a long reason short", () => {
    const long = { ...broken.broken[0], displayName: "YouTube", reason: "x".repeat(400), failures: 1, fixUrl: "https://elsewhere.example" };
    const reading = brokenAccountsReading({ ...broken, broken: [broken.broken[0], long] });
    expect(reading.value.split(" | ")).toHaveLength(2);
    expect(reading.value.length).toBeLessThan(600);
    expect(reading.value).toContain("1 failure)");
    expect(reading.value).toContain("/settings#accounts");
    expect(reading.value).not.toContain("elsewhere.example");
  });
});

describe("quotaReadings", () => {
  it("reads today's YouTube uploads and today's shorts against their limits", () => {
    const readings = quotaReadings({
      youtube: { used: 3, budget: 6 },
      shortsPerDay: 4,
      shortsByDay: new Map([["2026-10-14", 1], ["2026-10-15", 4], ["2026-10-16", 2]]),
      todayKey: "2026-10-14"
    });
    expect(readings).toEqual([
      { label: "Today's quota", value: "YouTube uploads 3/6; shorts booked for today 1/4." },
      { label: "Days at the shorts cap", value: "2026-10-15" }
    ]);
  });

  it("does not list a full day that is already past", () => {
    const readings = quotaReadings({
      youtube: { used: 0, budget: 6 },
      shortsPerDay: 2,
      shortsByDay: new Map([["2026-10-10", 2], ["2026-10-20", 2]]),
      todayKey: "2026-10-14"
    });
    expect(readings[1].value).toBe("2026-10-20");
  });

  it("admits what it does not know", () => {
    expect(quotaReadings({ shortsByDay: new Map() })).toEqual([
      { label: "Today's quota", value: "Not loaded yet." },
      { label: "Days at the shorts cap", value: "None." }
    ]);
  });

  it("skips the shorts half when there is no daily limit", () => {
    expect(quotaReadings({ youtube: { used: 1, budget: 6 }, shortsByDay: new Map() })[0].value).toBe("YouTube uploads 1/6.");
  });
});

describe("backupReading", () => {
  it("says it is checking before the status arrives", () => {
    expect(backupReading(null)).toEqual({ label: "Last backup", value: "Checking." });
  });

  it("passes the backup's own words through without the prefix", () => {
    expect(backupReading({ text: "Last backup: about 3 hours ago", warning: false })).toEqual({ label: "Last backup", value: "about 3 hours ago" });
  });

  it("flags a stale or failed backup", () => {
    expect(backupReading({ text: "Last backup: 5 days ago / failed: disk full", warning: true })).toEqual({
      label: "Last backup",
      value: "5 days ago / failed: disk full - needs attention"
    });
  });
});
