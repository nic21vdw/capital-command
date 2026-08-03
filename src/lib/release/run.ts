import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";

export const UPDATE_LOG = "update-app.log";

/**
 * Starts a release and returns immediately.
 *
 * The script this launches stops the server that is running this code — that
 * is the point of it — so the child has to outlive its parent. `detached`
 * gives it its own process group and console, and its output goes to a file
 * because there will be no pipe left to read it: by the time the release
 * fails, whatever would have caught stderr has already been killed.
 *
 * Nothing is validated here beyond "a release is not already running".
 * `update-app.ps1` is the gate — it refuses a checkout that is dirty or ahead
 * of main and backs out a merge that conflicts — and duplicating those checks
 * in TypeScript would just be a second, staler copy of them.
 */
export function startRelease(root = process.cwd()): { started: boolean; reason?: string } {
  if (releaseInFlight) return { started: false, reason: "An update is already running." };

  const script = join(root, "scripts", "update-app.ps1");
  const log = openSync(join(root, UPDATE_LOG), "w");

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log] }
  );

  child.unref();
  releaseInFlight = true;

  return { started: true };
}

// Per-process, and that is enough: the release restarts the server, so the
// flag only has to survive from the click until this process is killed.
let releaseInFlight = false;

export function isReleaseInFlight() {
  return releaseInFlight;
}
