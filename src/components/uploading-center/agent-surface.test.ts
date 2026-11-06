import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = path.resolve(__dirname, "..");
const read = (...segments: string[]) => readFileSync(path.join(COMPONENTS, ...segments), "utf8");

describe("the Uploading Center declares the booking form and the readings", () => {
  const page = read("uploading-center", "uploading-center-page.tsx");

  it("adds the Book clip fields, the Book control and the new readings to its surface", () => {
    expect(page).toContain("...bookFields(bookDraft, readyClips, timezone)");
    expect(page).toContain("bookControl(bookingContext(booking.phase === \"booking\"))");
    for (const reading of ["bookingReading(booking)", "queueStatusReadings(", "brokenAccountsReading(health)", "quotaReadings({", "backupReading(backup)"]) {
      expect(page, reading).toContain(reading);
    }
  });

  it("presses Book through the same scheduler a dropped clip uses, not a second path", () => {
    expect(page).toContain('if (id === "book") return pressBook();');
    expect(page).toMatch(/scheduleForBooking: BookScheduler<ReadyClip> = \(clip, override, hooks\) => handleSchedule\(clip, override, hooks\)/);
    expect(page).toMatch(/void handleSchedule\(clip, \{ platform, slotUtc \}\)/);
    expect(page).toMatch(/startBooking\(\s*bookDraftRef\.current,\s*bookingContext\(bookingRef\.current\.phase === "booking"\),\s*scheduleForBooking,\s*reportBooking/);
  });

  it("never posts to the queue itself, so no guard can be skipped", () => {
    for (const file of ["book-clip.ts", "book-clip-panel.tsx", "agent-readings.ts"]) {
      const source = read("uploading-center", file);
      expect(source, file).not.toMatch(/fetch\(/);
      expect(source, file).not.toContain("/api/publish");
    }
  });

  it("hands the schedule hook an outcome callback so the server's refusal reaches the agent", () => {
    const hook = read("uploading-center", "use-uploading-center.ts");
    expect(hook).toContain("onOutcome?: (outcome: ScheduleOutcome) => void");
    expect(hook).toContain('return refuse("Pick a schedule slot first.")');
    expect(hook).toContain("options.onOutcome?.({ ok: true, message: outcomeMessage })");
  });
});

describe("the readings other pages already give an agent stay declared", () => {
  it("Inbox reports unread comments in total and by platform", () => {
    const source = read("inbox", "inbox-page.tsx");
    expect(source).toContain('label: "Unread"');
    expect(source).toContain('label: "Unread by platform"');
  });

  it("Listening reports its new leads", () => {
    expect(read("listening", "listening-page.tsx")).toContain('label: "New leads"');
  });

});
