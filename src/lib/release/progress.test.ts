import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readReleaseProgress } from "@/lib/release/progress";

// Captured from a real offline release of a branch into main, so the shape the
// banner reads is pinned to what update-app.ps1 actually writes. The contract
// between the two is one line prefix each, and it is invisible when it breaks:
// the banner simply says nothing while an update runs.
const RELEASE_LOG = [
  "==> Starting the update",
  "",
  "==> Checking this checkout",
  "On: main, releasing: feature",
  "Could not reach GitHub - releasing what is already in this repository.",
  "",
  "==> What this update brings",
  "97bd8b8 A change to release",
  "",
  "==> Releasing feature",
  "Merge made by the 'ort' strategy.",
  "",
  "==> Dating the changelog",
  "Unreleased is now 2026-08-05.",
  "",
  "==> Installing dependencies (00m01s in)",
  "package-lock.json has not changed - skipping npm install.",
  "",
  "==> Building and starting the new version (00m03s in, takes a few minutes)"
].join("\r\n");

function logged(text: string) {
  const root = mkdtempSync(join(tmpdir(), "release-progress-"));
  writeFileSync(join(root, "update-app.log"), text);
  return root;
}

describe("readReleaseProgress", () => {
  it("reports the step a running release is on", async () => {
    const progress = await readReleaseProgress(logged(RELEASE_LOG));

    expect(progress.step).toBe("Building and starting the new version (00m03s in, takes a few minutes)");
    expect(progress.failed).toBeNull();
    expect(progress.tail).toContain("package-lock.json has not changed - skipping npm install.");
  });

  it("reports why a release stopped", async () => {
    const failure = [
      "==> Checking this checkout",
      "On: main, releasing: feature",
      "",
      "ERROR: feature does not merge cleanly into main, so nothing was changed."
    ].join("\r\n");

    const progress = await readReleaseProgress(logged(failure));

    expect(progress.failed).toBe("feature does not merge cleanly into main, so nothing was changed.");
  });

  it("says nothing when no release has ever run here", async () => {
    const progress = await readReleaseProgress(mkdtempSync(join(tmpdir(), "release-progress-")));

    expect(progress).toEqual({ step: null, failed: null, quietFor: null, tail: [] });
  });
});
