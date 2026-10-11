import { describe, expect, it } from "vitest";
import { bookedClip, listPlatforms } from "@/components/uploading-center/booked-clip";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const when = (iso: string) => `at ${iso.slice(0, 16)}`;

function item(id: string, publishAt: string, legs: Partial<Record<PlatformId, PlatformState["status"]>>): QueueItem {
  return {
    id,
    title: `Title ${id}`,
    publishAt,
    platforms: Object.fromEntries(Object.entries(legs).map(([platform, status]) => [platform, { status }]))
  } as unknown as QueueItem;
}

describe("listPlatforms", () => {
  it("reads as a sentence", () => {
    expect(listPlatforms(["youtube"])).toBe("YouTube");
    expect(listPlatforms(["youtube", "tiktok"])).toBe("YouTube and TikTok");
    expect(listPlatforms(["youtube", "tiktok", "instagram"])).toBe("YouTube, TikTok and Instagram");
  });
});

describe("bookedClip", () => {
  it("is null for a clip with nothing booked, so it keeps its full card", () => {
    expect(bookedClip([], when)).toBeNull();
  });

  it("is null while every leg has failed: that is not done, and the card keeps its retry route", () => {
    expect(bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "failed", tiktok: "failed" })], when)).toBeNull();
  });

  it("says when and where, in the app's platform order", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { facebook: "pending", youtube: "scheduled", instagram: "pending" })],
      when
    );
    expect(booked?.label).toBe("Scheduled at 2026-10-12T11:30 on YouTube, Instagram and Facebook");
    expect(booked?.title).toBe("Title a");
    expect(booked?.platforms).toEqual(["youtube", "instagram", "facebook"]);
    expect(booked?.failedLegs).toBe(0);
  });

  it("leads with the earliest booking and counts the others", () => {
    const booked = bookedClip(
      [
        item("late", "2026-10-15T11:30:00Z", { tiktok: "pending" }),
        item("early", "2026-10-12T11:30:00Z", { youtube: "scheduled" }),
        item("mid", "2026-10-13T11:30:00Z", { youtube: "scheduled" })
      ],
      when
    );
    expect(booked?.item.id).toBe("early");
    expect(booked?.label).toBe("Scheduled at 2026-10-12T11:30 on YouTube and TikTok and 2 more bookings");
  });

  it("names a single extra booking in the singular", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled" }), item("b", "2026-10-13T11:30:00Z", { youtube: "scheduled" })],
      when
    );
    expect(booked?.label).toMatch(/and 1 more booking$/);
  });

  it("does not list a platform whose leg failed, but counts the failure", () => {
    const booked = bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled", tiktok: "failed" })], when);
    expect(booked?.platforms).toEqual(["youtube"]);
    expect(booked?.label).toBe("Scheduled at 2026-10-12T11:30 on YouTube");
    expect(booked?.failedLegs).toBe(1);
  });

  it("ignores a fully failed sibling booking", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { youtube: "failed" }), item("b", "2026-10-13T11:30:00Z", { youtube: "scheduled" })],
      when
    );
    expect(booked?.item.id).toBe("b");
    expect(booked?.label).toBe("Scheduled at 2026-10-13T11:30 on YouTube");
  });

  it("says Posted, not Scheduled, once every leg is published", () => {
    const booked = bookedClip(
      [item("a", "2026-10-09T11:30:00Z", { youtube: "published", instagram: "published" })],
      when
    );
    expect(booked?.label).toBe("Posted at 2026-10-09T11:30 on YouTube and Instagram");
    expect(booked?.posted).toBe("all");
  });

  it("says Partly posted, naming only what is out, while other legs are pending or failed", () => {
    const pending = bookedClip([item("a", "2026-10-09T11:30:00Z", { youtube: "published", tiktok: "pending" })], when);
    expect(pending?.label).toBe("Partly posted at 2026-10-09T11:30 on YouTube");
    expect(pending?.posted).toBe("partly");
    const failed = bookedClip([item("a", "2026-10-09T11:30:00Z", { youtube: "published", tiktok: "failed" })], when);
    expect(failed?.label).toBe("Partly posted at 2026-10-09T11:30 on YouTube");
    expect(failed?.failedLegs).toBe(1);
  });

  it("is Partly posted when a later booking has not gone out yet", () => {
    const booked = bookedClip(
      [item("a", "2026-10-09T11:30:00Z", { youtube: "published" }), item("b", "2026-10-13T11:30:00Z", { youtube: "scheduled" })],
      when
    );
    expect(booked?.label).toBe("Partly posted at 2026-10-09T11:30 on YouTube and 1 more booking");
  });

  it("says Scheduled (never Booked) for anything not yet posted, scheduled or waiting alike", () => {
    expect(bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled", tiktok: "uploaded" })], when)?.posted).toBe("none");
    expect(bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "pending" })], when)?.label).toMatch(/^Scheduled /);
  });

  it("tones a scheduled row blue and a posted row green, from the shared statusTone", () => {
    expect(bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled" })], when)?.tone).toBe("info");
    expect(bookedClip([item("a", "2026-10-09T11:30:00Z", { youtube: "published" })], when)?.tone).toBe("success");
  });

  describe("a leg that cannot post by itself", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const slot = "2026-10-13T11:30:00Z";
    const disconnected = (platform: PlatformId) => platform !== "youtube";

    it("says what the board says for a reminder before its slot, in the warning tone", () => {
      const booked = bookedClip([item("a", slot, { youtube: "manual" })], when, { isConnected: (p) => disconnected(p), now });
      expect(booked?.label).toBe("Needs YouTube connection - at 2026-10-13T11:30");
      expect(booked?.label).not.toMatch(/Booked|Scheduled/);
      expect(booked?.tone).toBe("warning");
    });

    it("says what the board says for a pending leg on an unconnected account", () => {
      const booked = bookedClip([item("a", slot, { youtube: "pending" })], when, { isConnected: (p) => disconnected(p), now });
      expect(booked?.label).toBe("Needs YouTube connection - at 2026-10-13T11:30");
      expect(booked?.tone).toBe("warning");
    });

    it("names the legs that are fine as scheduled", () => {
      const booked = bookedClip([item("a", slot, { youtube: "manual", tiktok: "pending" })], when, {
        isConnected: (p) => disconnected(p),
        now
      });
      expect(booked?.label).toBe("Needs YouTube connection - at 2026-10-13T11:30; Scheduled on TikTok");
    });

    it("reads Post by hand once the slot has passed, and Retry to post once connected", () => {
      const late = new Date("2026-10-14T12:00:00Z");
      expect(bookedClip([item("a", slot, { youtube: "manual" })], when, { isConnected: () => false, now: late })?.label).toBe(
        "Post by hand - at 2026-10-13T11:30"
      );
      const retry = bookedClip([item("a", slot, { youtube: "manual" })], when, { isConnected: () => true, now });
      expect(retry?.label).toBe("Retry to post - at 2026-10-13T11:30");
      expect(retry?.tone).toBe("warning");
    });

    it("stays Scheduled when every account is connected", () => {
      const booked = bookedClip([item("a", slot, { youtube: "pending" })], when, { isConnected: () => true, now });
      expect(booked?.label).toBe("Scheduled at 2026-10-13T11:30 on YouTube");
      expect(booked?.tone).toBe("info");
    });
  });
});
