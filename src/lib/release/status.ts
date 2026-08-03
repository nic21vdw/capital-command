import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ReleaseStatus = {
  /** The commit the code answering this request was built from. */
  running: string | null;
  runningShort: string | null;
  builtAt: string | null;
  /** What `git rev-parse HEAD` says — the checkout, which a build can lag. */
  head: string | null;
  /** The tip of the branch releases come from. */
  latest: string | null;
  latestShort: string | null;
  branch: string | null;
  /** Only the production checkout may release, and only it should be asked to. */
  releasable: boolean;
  /** Commits on the release branch that the running build does not have. */
  pending: PendingCommit[];
  /** The Unreleased bullets from the release branch's CHANGELOG. */
  notes: string[];
  error: string | null;
};

export type PendingCommit = { commit: string; subject: string };

export const RELEASE_BRANCH = "dev";
export const PRODUCTION_BRANCH = "main";

/**
 * A running build is not the same thing as a checkout. `next start` serves
 * whatever is in `.next`, so a release that merged but never rebuilt still
 * serves the old code — the failure `.next/BUILD_COMMIT` exists to catch. The
 * banner therefore compares the RUNNING build against the release branch, not
 * HEAD against it: "there is an update" has to mean "the app on screen is not
 * the latest code", whichever of the two steps fell behind.
 */
function readRunningCommit(root: string): { commit: string | null; builtAt: string | null } {
  const stamp = join(root, ".next", "BUILD_COMMIT");
  if (!existsSync(stamp)) return { commit: null, builtAt: null };
  try {
    const commit = readFileSync(stamp, "utf8").trim();
    const builtAt = statSync(stamp).mtime.toISOString();
    return { commit: commit || null, builtAt };
  } catch {
    return { commit: null, builtAt: null };
  }
}

async function git(root: string, args: string[], timeout = 15_000) {
  const { stdout } = await run("git", ["-C", root, ...args], { timeout, windowsHide: true });
  return stdout.trim();
}

/**
 * The Unreleased block of a CHANGELOG, as one line per entry.
 *
 * The file's bullets wrap over several lines and lead with a bolded sentence
 * that says what changed in the terms Nic reads for; that sentence is the
 * whole value, so each bullet collapses to a single line and the rest of its
 * prose is left in the file.
 */
export function parseUnreleased(changelog: string): string[] {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line));
  if (start === -1) return [];

  const notes: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (!current.length) return;
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text) notes.push(text);
    current = [];
  };

  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      current.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (current.length) current.push(line.trim());
  }
  flush();

  return notes.map(headlineOf);
}

/**
 * `**A sentence.** the details…` → `A sentence.` A bullet with no bolded lead
 * keeps its first sentence, so nothing is dropped for want of formatting.
 */
function headlineOf(entry: string): string {
  const bold = entry.match(/^\*\*(.+?)\*\*/);
  if (bold) return bold[1].trim();
  const sentence = entry.match(/^(.+?[.!?])(\s|$)/);
  return (sentence ? sentence[1] : entry).replace(/\*\*/g, "").trim();
}

export function parsePendingCommits(log: string): PendingCommit[] {
  return log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, ...rest] = line.split(" ");
      return { commit, subject: rest.join(" ") };
    });
}

export async function readReleaseStatus(root = process.cwd()): Promise<ReleaseStatus> {
  const { commit: running, builtAt } = readRunningCommit(root);
  const status: ReleaseStatus = {
    running,
    runningShort: running ? running.slice(0, 7) : null,
    builtAt,
    head: null,
    latest: null,
    latestShort: null,
    branch: null,
    releasable: false,
    pending: [],
    notes: [],
    error: null
  };

  try {
    status.branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    status.head = await git(root, ["rev-parse", "HEAD"]);
  } catch {
    status.error = "This copy is not a git checkout, so there is nothing to compare against.";
    return status;
  }

  // Only the production checkout releases. A sandbox worktree sits on its own
  // branch with its own half-finished work, and inviting it to merge dev into
  // main from inside the app is the one thing the two-lane split exists to
  // prevent.
  status.releasable =
    status.branch === PRODUCTION_BRANCH && existsSync(join(root, "scripts", "update-app.ps1"));

  if (!status.releasable) return status;

  // Best effort: an offline machine should report "up to date as far as it can
  // tell" rather than an error banner, so a failed fetch falls through to the
  // last-known remote ref.
  try {
    await git(root, ["fetch", "origin", RELEASE_BRANCH, "--quiet"], 25_000);
  } catch {
    // Keep going with whatever origin/dev was last known to be.
  }

  const ref = `origin/${RELEASE_BRANCH}`;
  try {
    status.latest = await git(root, ["rev-parse", ref]);
    status.latestShort = status.latest.slice(0, 7);
  } catch {
    status.error = `There is no ${ref} to compare against.`;
    return status;
  }

  // Nothing to compare a build against if the build was never stamped (a dev
  // server, a wiped .next). Fall back to the checkout so the banner is quiet
  // rather than wrong.
  const base = running ?? status.head;
  if (!base) return status;

  try {
    status.pending = parsePendingCommits(
      await git(root, ["log", "--format=%h %s", `${base}..${ref}`])
    );
  } catch {
    // A build commit that no longer exists here (a rewritten branch) can't be
    // ranged from; treat it as unknown rather than as an update.
    status.error = "Cannot tell which commits are new — the running build's commit is unknown here.";
    return status;
  }

  if (status.pending.length) {
    try {
      status.notes = parseUnreleased(await git(root, ["show", `${ref}:CHANGELOG.md`], 20_000));
    } catch {
      status.notes = [];
    }
  }

  return status;
}
