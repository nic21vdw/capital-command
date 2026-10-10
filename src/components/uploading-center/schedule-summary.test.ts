import { describe, expect, it } from "vitest";
import { bookedResult, refusedResult, summarizeAutoAssign, summarizeSchedule } from "@/components/uploading-center/schedule-summary";

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
    expect(manual.detail).toBe("saved as a manual reminder - connect it in Settings to post automatically.");
    const summary = summarizeSchedule([bookedResult("youtube", undefined, undefined), manual]);
    expect(summary.title).toBe("Scheduled on 1 platform, 1 saved as a manual reminder");
    expect(summary.level).toBe("warning");
    const only = summarizeSchedule([manual]);
    expect(only.title).toBe("Saved as a manual reminder on 1 platform");
  });
});

describe("Auto Assign summary", () => {
  const base = { scheduled: 3, manual: 0, total: 3, manualPlatforms: [], firstError: null, held: "" };

  it("stays green only when every post will actually go out", () => {
    expect(summarizeAutoAssign(base)).toEqual({
      level: "success",
      message: "Auto-assigned 3 posts to the next open slots."
    });
  });

  it("is amber and separates manual reminders from booked posts", () => {
    const summary = summarizeAutoAssign({ ...base, manual: 1, manualPlatforms: ["TikTok"] });
    expect(summary.level).toBe("warning");
    expect(summary.message).toBe(
      "Auto-assigned 2 posts to the next open slots. 1 post saved as a manual reminder for TikTok - connect it in Settings to post automatically."
    );
  });

  it("never says Auto-assigned when everything booked is a reminder", () => {
    const summary = summarizeAutoAssign({ ...base, manual: 3, manualPlatforms: ["TikTok", "TikTok", "TikTok"] });
    expect(summary.level).toBe("warning");
    expect(summary.message).toMatch(/^Saved 3 posts as manual reminders for TikTok - connect it in Settings/);
    expect(summary.message).not.toMatch(/Auto-assigned/);
  });

  it("is red when nothing was booked", () => {
    expect(summarizeAutoAssign({ ...base, scheduled: 0, firstError: "Slot taken." }).level).toBe("error");
  });
});
