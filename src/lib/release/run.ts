import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_BRANCH } from "@/lib/release/shared";

export const UPDATE_LOG = "update-app.log";

/**
 * Starts a release and returns immediately.
 *
 * The script this launches stops the server that is running this code — that
 * is the point of it — so the release has to outlive its parent AND survive a
 * kill of the whole process tree. Two things follow, and both were wrong here:
 *
 * `spawn(..., { detached: true })` on a PowerShell child does not detach it,
 * it stops it running at all. The process exits 0 immediately and the script
 * never executes a line, so every "Install and restart" ever clicked reported
 * that it had started an update and then did precisely nothing. It launches
 * through `Start-Process` instead, which gives the release its own hidden
 * console and a parent that is gone a moment later.
 *
 * The script also writes its own log rather than having its output redirected
 * here, because a detached child's inherited stdout and stderr go to that new
 * console and not to the file — which is why `update-app.log` was zero bytes
 * even on the runs that did something.
 *
 * Nothing is validated here beyond "a release is not already running".
 * `update-app.ps1` is the gate — it refuses a checkout that is dirty or ahead
 * of main and backs out a merge that conflicts — and duplicating those checks
 * in TypeScript would just be a second, staler copy of them.
 */
export function startRelease(root = process.cwd()): { started: boolean; reason?: string } {
  if (releaseInFlight) return { started: false, reason: "An update is already running." };

  const script = join(root, "scripts", "update-app.ps1");
  const logPath = join(root, UPDATE_LOG);

  // Truncated here, appended to there: the first line has to exist before
  // PowerShell has finished starting, or the banner's first poll sees the
  // PREVIOUS release's log and reports a stale step.
  try {
    writeFileSync(logPath, "==> Starting the update\r\n");
  } catch {
    // A log that cannot be written is not a reason to refuse to update.
  }

  const releaseArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Branch",
    RELEASE_BRANCH,
    "-LogPath",
    logPath
  ];

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList ${releaseArgs
        .map((arg) => `'${arg.replace(/'/g, "''")}'`)
        .join(",")}`
    ],
    { cwd: root, windowsHide: true, stdio: "ignore" }
  );

  // Nothing else can report this: the process that would have thrown is gone
  // by the time anyone looks, and an unhandled 'error' event would take the
  // server down with it.
  child.on("error", (error) => {
    try {
      appendFileSync(logPath, `\r\nERROR: Could not start the update — ${error.message}\r\n`);
    } catch {
      // Nothing left to do about it.
    }
    releaseInFlight = false;
  });

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
