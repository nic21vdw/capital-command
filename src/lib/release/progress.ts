import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_LOG } from "@/lib/release/run";

export type ReleaseProgress = {
  /** The last thing the release said it was doing, for the banner. */
  step: string | null;
  /** Set when the release stopped on an error rather than finishing. */
  failed: string | null;
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
    return { step: null, failed: null, quietFor: null, tail: [] };
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const steps = lines.filter((line) => line.startsWith("==> "));
  const failure = lines.find((line) => line.startsWith("ERROR: "));
  return {
    step: steps.length ? steps[steps.length - 1].slice(4) : null,
    failed: failure ? failure.slice(7) : null,
    quietFor,
    tail: lines.slice(-12)
  };
}
