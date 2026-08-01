import { describe, expect, it } from "vitest";
import {
  channelForLabel,
  channelKindOf,
  countByKind,
  eventTargetsChannel,
  isChannelId,
  sortEvents
} from "@/lib/channels/platforms";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

function event(
  overrides: Partial<MasterCalendarEvent> & Pick<MasterCalendarEvent, "id" | "source" | "dateKey">
): MasterCalendarEvent {
  return { title: "x", platforms: [], status: "scheduled", ...overrides };
}

describe("channelForLabel", () => {
  it("matches the display labels the aggregator emits", () => {
    expect(channelForLabel("YouTube")).toBe("youtube");
    expect(channelForLabel("Instagram")).toBe("instagram");
    expect(channelForLabel("TikTok")).toBe("tiktok");
    expect(channelForLabel("Facebook")).toBe("facebook");
    expect(channelForLabel("Threads")).toBe("threads");
  });

  it("reads the aliases a free-text platform field may use", () => {
    expect(channelForLabel("  reels ")).toBe("instagram");
    expect(channelForLabel("FB")).toBe("facebook");
    expect(channelForLabel("X")).toBe("threads");
  });

  it("is null for a label no channel claims", () => {
    expect(channelForLabel("LinkedIn")).toBeNull();
    expect(channelForLabel("")).toBeNull();
  });
});

describe("eventTargetsChannel", () => {
  it("keeps an event that names the channel among several platforms", () => {
    const item = event({
      id: "shorts:1",
      source: "shorts",
      dateKey: "2026-07-30",
      platforms: ["YouTube", "TikTok"]
    });
    expect(eventTargetsChannel(item, "tiktok")).toBe(true);
    expect(eventTargetsChannel(item, "facebook")).toBe(false);
  });

  it("drops an event with no platforms at all rather than showing it everywhere", () => {
    const item = event({ id: "content:1", source: "content", dateKey: "2026-07-30" });
    for (const channel of ["youtube", "instagram", "tiktok", "facebook", "threads"] as const) {
      expect(eventTargetsChannel(item, channel)).toBe(false);
    }
  });
});

describe("channelKindOf", () => {
  it("groups by the shape of the post, not the subsystem", () => {
    expect(channelKindOf(event({ id: "a", source: "shorts", dateKey: "2026-07-30" }))).toBe("short");
    expect(channelKindOf(event({ id: "b", source: "content", dateKey: "2026-07-30" }))).toBe("longform");
    expect(channelKindOf(event({ id: "c", source: "carousels", dateKey: "2026-07-30" }))).toBe("carousel");
    expect(channelKindOf(event({ id: "d", source: "x", dateKey: "2026-07-30" }))).toBe("text");
    expect(channelKindOf(event({ id: "e", source: "fb", dateKey: "2026-07-30" }))).toBe("text");
  });
});

describe("countByKind", () => {
  it("reports every kind, including the empty ones", () => {
    const counts = countByKind([
      event({ id: "a", source: "shorts", dateKey: "2026-07-30" }),
      event({ id: "b", source: "shorts", dateKey: "2026-07-31" }),
      event({ id: "c", source: "x", dateKey: "2026-07-30" })
    ]);
    expect(counts).toEqual([
      { kind: "short", count: 2 },
      { kind: "longform", count: 0 },
      { kind: "carousel", count: 0 },
      { kind: "text", count: 1 }
    ]);
  });
});

describe("sortEvents", () => {
  it("puts day-level items ahead of the timed plan, then runs chronologically", () => {
    const sorted = sortEvents([
      event({ id: "c", source: "shorts", dateKey: "2026-07-31", time: "09:00" }),
      event({ id: "b", source: "shorts", dateKey: "2026-07-30", time: "18:00" }),
      event({ id: "a", source: "fb", dateKey: "2026-07-30" })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("isChannelId", () => {
  it("guards the route parameter", () => {
    expect(isChannelId("tiktok")).toBe(true);
    expect(isChannelId("myspace")).toBe(false);
  });
});
