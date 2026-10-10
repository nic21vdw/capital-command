import { describe, expect, it } from "vitest";
import { bookedResult, refusedResult, summarizeSchedule } from "@/components/uploading-center/schedule-summary";

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
});
