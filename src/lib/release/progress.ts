import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_LOG } from "@/lib/release/run";

/** The line update-app.ps1 ends a good release with. */
const RELEASE_DONE = "Capital Command is updated and running";

/** The line every release opens with, so elapsed time survives the restart. */
const RELEASE_STARTED = /^Update started (.+)$/;

/** What a step writes while it is still working, so a slow build is not silence. */
const HEARTBEAT = "... ";

export type ReleaseProgress = {
  /** The last thing the release said it was doing, for the banner. */
  step: string | null;
  /** Set when the release stopped on an error rather than finishing. */
  failed: string | null;
  /** Set when the release got all the way to a running app. */
  finished: boolean;
  /** When this release started, in epoch ms. Null when the log has no stamp. */
  startedAt: number | null;
  /** How long since the log last moved, in seconds. Null when there is no log. */
  quietFor: number | null;
  tail: string[];
};

/**
 * What the running release is doing, read back out of its log.
 *
 * The release kills the server that started it, so nothing can hold progress in
 * memory across it — the log on disk is the only thing that survives, and it is
 * also the only place a failure after the restart can be found.
 */
export async function readReleaseProgress(root = process.cwd()): Promise<ReleaseProgress> {
  const path = join(root, UPDATE_LOG);
  let text: string;
  let quietFor: number | null = null;
  try {
    const [file, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    text = file;
    quietFor = Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000));
  } catch {
    return { step: null, failed: null, finished: false, startedAt: null, quietFor: null, tail: [] };
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const steps = lines.filter((line) => line.startsWith("==> "));
  const failure = lines.find((line) => line.startsWith("ERROR: "));
  return {
    step: steps.length ? steps[steps.length - 1].slice(4) : null,
    failed: failure ? failure.slice(7) : null,
    finished: lines.some((line) => line.startsWith(RELEASE_DONE)),
    startedAt: startedAtOf(lines),
    quietFor,
    // Heartbeats keep the log moving through a long build, which is what stops
    // a release being read as abandoned. They say nothing on their own, so they
    // are kept out of the tail rather than crowding out the last real lines.
    tail: lines.filter((line) => !line.startsWith(HEARTBEAT)).slice(-12)
  };
}

function startedAtOf(lines: string[]): number | null {
  for (const line of lines) {
    const stamp = line.match(RELEASE_STARTED);
    if (!stamp) continue;
    const at = Date.parse(stamp[1].trim());
    if (!Number.isNaN(at)) return at;
  }
  return null;
}
