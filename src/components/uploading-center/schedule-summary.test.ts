import { describe, expect, it } from "vitest";
import { NO_AI_CAPTION_SUMMARY_NOTE, bookedDatesLabel, bookedResult, refusedResult, summarizeAutoAssign, summarizeSchedule, zoneTimeLabel } from "@/components/uploading-center/schedule-summary";

describe("one summary for a multi-platform booking", () => {
  it("counts Instagram as Instagram and Facebook, and says so", () => {
    const summary = summarizeSchedule([
      bookedResult("youtube", undefined, { platform: "youtube", outcome: "scheduled", detail: "" }),
      bookedResult("tiktok", undefined, undefined),
      bookedResult("instagram", undefined, undefined)
    ]);
    expect(summary.title).toBe("Scheduled on 4 platforms (Instagram and Facebook as one post)");
    expect(summary.level).toBe("success");
    expect(summary.lines).toEqual([
      "YouTube: uploaded and scheduled on your channel.",
      "TikTok: scheduled.",
      "Instagram and Facebook (one post): scheduled."
    ]);
  });

  it("names the platform that failed and says why, in words", () => {
    const summary = summarizeSchedule([
      bookedResult("youtube", undefined, undefined),
      refusedResult("tiktok", "2026-10-12 already has 2 shorts booked, which is the daily limit (PUBLISH_SHORTS_PER_DAY). Pick another day."),
      bookedResult("instagram", undefined, undefined)
    ]);
    expect(summary.title).toBe("Scheduled on 3 of 4 platforms (Instagram and Facebook as one post)");
    expect(summary.level).toBe("warning");
    expect(summary.lines[1]).toMatch(/^TikTok: not booked - 2026-10-12 already has 2 shorts booked/);
    expect(summary.lines[1]).toMatch(/Pick another day\.$/);
  });

  it("is red, not green, when nothing was booked", () => {
    const summary = summarizeSchedule([refusedResult("youtube", "Slot taken"), refusedResult("tiktok", "Slot taken.")]);
    expect(summary.level).toBe("error");
    expect(summary.title).toBe("Nothing was scheduled on 2 platforms");
  });

  it("does not call a booked post with a failed upload a success", () => {
    const summary = summarizeSchedule([
      bookedResult("youtube", undefined, { platform: "youtube", outcome: "failed", detail: "YouTube connection expired." }),
      bookedResult("tiktok", undefined, undefined)
    ]);
    expect(summary.level).toBe("error");
    expect(summary.lines[0]).toBe("YouTube: booked, but the upload failed - YouTube connection expired.");
  });

  it("flags a platform saved as a manual reminder", () => {
    const manual = bookedResult("tiktok", { platforms: { tiktok: { status: "manual", attempts: 0 } } }, undefined);
    expect(manual.level).toBe("warning");
    expect(summarizeSchedule([manual, bookedResult("youtube", undefined, undefined)]).level).toBe("warning");
  });

  it("counts booked and manual separately in the summary title", () => {
    const manual = bookedResult("tiktok", { platforms: { tiktok: { status: "manual", attempts: 0 } } }, undefined);
    expect(manual.manual).toBe(true);
    expect(manual.detail).toBe("saved as a reminder - not connected. Connect it to post automatically.");
    const summary = summarizeSchedule([bookedResult("youtube", undefined, undefined), manual]);
    expect(summary.title).toBe("Scheduled on 1 platform, 1 saved as a reminder");
    expect(summary.level).toBe("warning");
    const only = summarizeSchedule([manual]);
    expect(only.title).toBe("Saved as a reminder on 1 platform");
  });
});

describe("Auto Assign summary", () => {
  const base = { scheduled: 3, manual: 0, total: 3, manualPlatforms: [], firstError: null, held: "" };
  const zone = "America/Toronto";
  // Mon Oct 12 .. Thu Oct 15 2026 at 7:30 Toronto time (EDT, UTC-4).
  const monThu = ["2026-10-12T11:30:00.000Z", "2026-10-13T11:30:00.000Z", "2026-10-14T11:30:00.000Z", "2026-10-15T11:30:00.000Z"];

  it("stays green only when every post will actually go out, and says so", () => {
    expect(summarizeAutoAssign({ ...base, scheduled: 4, total: 4, bookedSlots: monThu, timeZone: zone })).toEqual({
      level: "success",
      message: "4 booked for Oct 12-15. They will post automatically."
    });
    expect(summarizeAutoAssign({ ...base, scheduled: 1, total: 1, bookedSlots: monThu.slice(0, 1), timeZone: zone }).message).toBe(
      "1 booked for Oct 12. It will post automatically."
    );
  });

  it("says the dates in the publish zone, not UTC", () => {
    // 01:00 UTC on the 13th is still the evening of the 12th in Toronto.
    expect(bookedDatesLabel(["2026-10-13T01:00:00.000Z"], zone)).toBe("Oct 12");
    expect(bookedDatesLabel(["2026-10-13T01:00:00.000Z"], "UTC")).toBe("Oct 13");
  });

  it("writes a range within a month, across months, and nothing when it has no dates", () => {
    expect(bookedDatesLabel(monThu, zone)).toBe("Oct 12-15");
    expect(bookedDatesLabel(["2026-11-02T15:30:00.000Z", "2026-10-28T11:30:00.000Z"], zone)).toBe("Oct 28-Nov 2");
    expect(bookedDatesLabel([], zone)).toBe("");
    expect(bookedDatesLabel(["not a date"], zone)).toBe("");
    expect(summarizeAutoAssign(base).message).toBe("3 booked. They will post automatically.");
  });

  it("is amber and says reminders, not bookings, when nothing is connected", () => {
    const summary = summarizeAutoAssign({
      ...base,
      scheduled: 4,
      manual: 4,
      total: 4,
      manualPlatforms: ["YouTube", "YouTube", "YouTube", "YouTube"],
      bookedSlots: monThu,
      timeZone: zone
    });
    expect(summary).toEqual({
      level: "warning",
      message: "4 booked for Oct 12-15 as reminders. Connect YouTube to post automatically."
    });
  });

  it("shows both halves of a mixed batch", () => {
    const summary = summarizeAutoAssign({
      ...base,
      scheduled: 4,
      manual: 1,
      total: 4,
      manualPlatforms: ["TikTok"],
      bookedSlots: monThu,
      timeZone: zone
    });
    expect(summary.level).toBe("warning");
    expect(summary.message).toBe(
      "4 booked for Oct 12-15: 3 will post automatically, 1 is a reminder. Connect TikTok to post automatically."
    );
  });

  it("names every unconnected platform and agrees the verb", () => {
    const summary = summarizeAutoAssign({ ...base, manual: 3, manualPlatforms: ["YouTube", "TikTok"] });
    expect(summary.message).toBe("3 booked as reminders. Connect YouTube and TikTok to post automatically.");
  });

  it("never says Auto-assigned or Manual", () => {
    for (const manual of [0, 1, 3]) {
      const message = summarizeAutoAssign({ ...base, manual, manualPlatforms: ["TikTok"] }).message;
      expect(message).not.toMatch(/Auto-assigned|manual/i);
    }
  });

  it("reports what was not booked beside what was", () => {
    const summary = summarizeAutoAssign({ ...base, scheduled: 2, total: 3, firstError: "Slot taken." });
    expect(summary.level).toBe("warning");
    expect(summary.message).toBe("2 booked. They will post automatically. 1 not booked - Slot taken.");
  });

  it("is red when nothing was booked", () => {
    expect(summarizeAutoAssign({ ...base, scheduled: 0, firstError: "Slot taken." }).level).toBe("error");
  });

  it("keeps the clips it left out in the amber summary", () => {
    const summary = summarizeAutoAssign({ ...base, held: " 1 clip left unscheduled." });
    expect(summary.level).toBe("warning");
    expect(summary.message).toBe("3 booked. 1 clip left unscheduled.");
    // One sentence, not one per count: the message stays short enough to read once.
    expect(summary.message.length).toBeLessThan(80);
  });
});

describe("the no-AI-key note in the booking summary", () => {
  const base = { scheduled: 4, manual: 0, total: 4, manualPlatforms: [], firstError: null, held: "" };

  it("rides at the end of the persisted summary, amber, so it outlives the toast", () => {
    const summary = summarizeAutoAssign({ ...base, note: NO_AI_CAPTION_SUMMARY_NOTE });
    expect(NO_AI_CAPTION_SUMMARY_NOTE).toBe(
      "Captions are the clip titles (no AI key) - edit them from each post's Caption button."
    );
    expect(summary.level).toBe("warning");
    expect(summary.message).toBe(`4 booked. They will post automatically. ${NO_AI_CAPTION_SUMMARY_NOTE}`);
  });

  it("is said after every other line, and never turns a red summary any other colour", () => {
    const mixed = summarizeAutoAssign({ ...base, scheduled: 3, firstError: "Slot taken.", note: NO_AI_CAPTION_SUMMARY_NOTE });
    expect(mixed.message.endsWith(NO_AI_CAPTION_SUMMARY_NOTE)).toBe(true);
    expect(mixed.level).toBe("warning");
    const unbooked = summarizeAutoAssign({ ...base, scheduled: 0, firstError: "Slot taken.", note: NO_AI_CAPTION_SUMMARY_NOTE });
    // Nothing was booked, so there are no posts to edit a caption on.
    expect(unbooked.level).toBe("error");
    expect(unbooked.message).not.toContain("Caption button");
  });

  it("changes nothing when there is no note", () => {
    expect(summarizeAutoAssign(base)).toEqual({ level: "success", message: "4 booked. They will post automatically." });
  });
});

describe("zoneTimeLabel", () => {
  it("names the city, never the IANA id", () => {
    expect(zoneTimeLabel("America/Toronto")).toBe("Toronto time");
    expect(zoneTimeLabel("America/Port_of_Spain")).toBe("Port of Spain time");
    expect(zoneTimeLabel("UTC")).toBe("UTC");
  });
});
