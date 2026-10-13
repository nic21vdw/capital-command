import { describe, expect, it } from "vitest";
import { joinNames, legLines, MIXED_LABEL, summarizeEventStatus } from "@/lib/master-calendar/legSummary";
import { waitingForConnectionLabel } from "@/lib/publisher/nativeScheduling";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

const event = (status: string, legs: NonNullable<MasterCalendarEvent["legs"]>, over: Partial<MasterCalendarEvent> = {}): MasterCalendarEvent => ({
  id: "shorts:q1",
  source: "shorts",
  dateKey: "2026-10-14",
  time: "15:00",
  title: "A short",
  platforms: legs.map((leg) => leg.platform),
  status,
  legs,
  ...over
});

describe("joinNames", () => {
  it("reads as a short list", () => {
    expect(joinNames(["YouTube"])).toBe("YouTube");
    expect(joinNames(["YouTube", "Instagram"])).toBe("YouTube and Instagram");
    expect(joinNames(["YouTube", "Instagram", "Facebook"])).toBe("YouTube, Instagram and Facebook");
  });
});

describe("a post whose legs agree", () => {
  it("keeps its single chip", () => {
    const summary = summarizeEventStatus(
      event("needs connection", [
        { platform: "Instagram", status: "pending", late: "needs-connection" },
        { platform: "Facebook", status: "pending", late: "needs-connection" }
      ])
    );
    expect(summary.mixed).toBe(false);
    expect(summary.label).toBe("Needs connection");
    expect(summary.lines).toHaveLength(1);
  });

  it("names the platform when one leg waits for a connection before its slot", () => {
    const summary = summarizeEventStatus(event("awaiting connection", [{ platform: "YouTube", status: "pending", awaitingConnection: true }]));
    expect(summary.mixed).toBe(false);
    expect(summary.label).toBe("Needs YouTube connection");
    expect(summary.label).toBe(waitingForConnectionLabel("youtube"));
    expect(summary.lines[0].text).toBe("Connect YouTube before 3:00 PM to post automatically, or post it by hand.");
    // It is not late, and must not say it was missed.
    expect(summary.lines[0].text).not.toMatch(/passed|missed|could be sent/);
    expect(summary.lines[0].action).toBe("connect");
  });

  it("leaves statuses that are not about timing or a connection alone", () => {
    const summary = summarizeEventStatus(
      event("scheduled", [
        { platform: "YouTube", status: "scheduled" },
        { platform: "Instagram", status: "pending" }
      ])
    );
    expect(summary.mixed).toBe(false);
    expect(summary.label).toBe("scheduled");
  });
});

describe("a post whose legs differ", () => {
  const mixed = event("needs connection", [
    { platform: "YouTube", status: "scheduled", late: "should-be-live" },
    { platform: "Instagram", status: "pending", late: "needs-connection" },
    { platform: "Facebook", status: "pending", late: "needs-connection" }
  ]);

  it("says Mixed on the chip and tells the platforms apart underneath", () => {
    const summary = summarizeEventStatus(mixed);
    expect(summary.mixed).toBe(true);
    expect(summary.label).toBe(MIXED_LABEL);
    expect(summary.lines.map((line) => [line.kind, line.platforms])).toEqual([
      ["shouldBeLive", ["YouTube"]],
      ["needsConnection", ["Instagram", "Facebook"]]
    ]);
  });

  it("summarises per platform in one brief line", () => {
    expect(summarizeEventStatus(mixed).headline).toBe("YouTube should be live · Instagram, Facebook need connection");
  });

  it("words a past connection as a miss and a coming one as a deadline", () => {
    const past = legLines(mixed)[1];
    expect(past.text).toBe("Instagram and Facebook are not connected and the slot passed, so nothing could be sent.");
    const upcoming = summarizeEventStatus(
      event("awaiting connection", [
        { platform: "YouTube", status: "scheduled" },
        { platform: "Instagram", status: "pending", awaitingConnection: true },
        { platform: "Facebook", status: "pending", awaitingConnection: true }
      ]),
      { when: "Tue, Oct 14, 15:00" }
    );
    expect(upcoming.mixed).toBe(true);
    expect(upcoming.headline).toBe("YouTube is scheduled · Instagram, Facebook need connection");
    expect(upcoming.lines[1].text).toBe("Connect Instagram and Facebook before Tue, Oct 14, 15:00 to post automatically, or post it by hand.");
    expect(upcoming.lines[1].upcoming).toBe(true);
    expect(upcoming.lines[0]).toMatchObject({ kind: "scheduled", attention: false });
  });

  it("keeps a live leg beside one that is overdue", () => {
    const summary = summarizeEventStatus(
      event("overdue", [
        { platform: "YouTube", status: "published" },
        { platform: "TikTok", status: "pending", late: "overdue" }
      ])
    );
    expect(summary.mixed).toBe(true);
    expect(summary.headline).toBe("YouTube is live · TikTok is overdue");
  });

  it("is not mixed without per-platform legs", () => {
    const summary = summarizeEventStatus({ ...mixed, legs: undefined });
    expect(summary.mixed).toBe(false);
    expect(summary.label).toBe("Needs connection");
    expect(summary.lines).toEqual([]);
  });
});

describe("a booked leg that has not gone out", () => {
  it("is called scheduled, not queued, and its slot is written as a 12-hour clock", () => {
    const lines = legLines(event("queued", [{ platform: "Instagram", status: "pending" }, { platform: "YouTube", status: "pending", awaitingConnection: true }]));
    expect(lines.find((line) => line.kind === "queued")?.text).toBe("Instagram is scheduled.");
    expect(lines.find((line) => line.kind === "needsConnection")?.text).toContain("before 3:00 PM");
  });
});
