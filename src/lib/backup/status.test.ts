import { describe, expect, it } from "vitest";
import { describeBackup } from "@/lib/backup/status";

const now = new Date("2026-10-13T15:00:00.000Z");

describe("describeBackup", () => {
  it("warns when a backup has never run", () => {
    const view = describeBackup(null, now);
    expect(view.text).toBe("Last backup: never");
    expect(view.warning).toBe(true);
  });

  it("shows a recent successful backup without a warning", () => {
    const view = describeBackup({ at: "2026-10-13T12:00:00.000Z", ok: true, path: "G:\b.zip", bytes: 10 }, now);
    expect(view.text).toMatch(/^Last backup: (about )?3 hours ago$/);
    expect(view.warning).toBe(false);
  });

  it("warns once the last good backup is older than 48 hours", () => {
    const view = describeBackup({ at: "2026-10-10T12:00:00.000Z", ok: true, path: "G:\b.zip", bytes: 10 }, now);
    expect(view.text).toMatch(/^Last backup: 3 days ago$/);
    expect(view.warning).toBe(true);
  });

  it("does not warn just inside 48 hours", () => {
    const view = describeBackup({ at: "2026-10-11T15:30:00.000Z", ok: true, path: "G:\b.zip", bytes: 10 }, now);
    expect(view.warning).toBe(false);
  });

  it("reports the failure reason and the last good backup", () => {
    const view = describeBackup(
      {
        at: "2026-10-13T14:00:00.000Z",
        ok: false,
        error: "Google Drive folder not found",
        lastSuccessAt: "2026-10-13T03:30:00.000Z"
      },
      now
    );
    expect(view.text).toMatch(/^Last backup: (about )?\d+ hours ago \/ failed: Google Drive folder not found$/);
    expect(view.warning).toBe(true);
  });

  it("warns on a failure even when the previous backup is recent", () => {
    const view = describeBackup(
      { at: "2026-10-13T14:00:00.000Z", ok: false, error: "disk full", lastSuccessAt: "2026-10-13T03:30:00.000Z" },
      now
    );
    expect(view.warning).toBe(true);
  });

  it("says never when the only attempt failed", () => {
    const view = describeBackup({ at: "2026-10-13T14:00:00.000Z", ok: false, error: "no folder" }, now);
    expect(view.text).toBe("Last backup: never / failed: no folder");
    expect(view.warning).toBe(true);
  });

  it("treats an unreadable timestamp as never", () => {
    const view = describeBackup({ at: "garbage", ok: true }, now);
    expect(view.text).toBe("Last backup: never");
    expect(view.warning).toBe(true);
  });
});
