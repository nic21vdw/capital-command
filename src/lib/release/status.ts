import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { pickMostAdvanced, releaseRefCandidates } from "@/lib/release/refs";
import {
  PRODUCTION_BRANCH,
  RELEASE_BRANCH,
  parsePendingCommits,
  parseUnreleased,
  type ReleaseStatus
} from "@/lib/release/shared";

const run = promisify(execFile);

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

async function resolves(root: string, ref: string): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Every remote this checkout has, in the order git lists them. */
async function listRemotes(root: string): Promise<string[]> {
  try {
    const out = await git(root, ["remote"]);
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Bring every remote's copy of the release branch up to date, best effort.
 *
 * They are fetched together because one of them is a folder on this disk and
 * the other is over the network — waiting for the slow one to start the fast
 * one would double the cost of a check that already runs on a timer. None of
 * them may fail the check: an offline machine reports "up to date as far as it
 * can tell", which is the honest answer.
 */
async function fetchAll(root: string, remotes: string[]): Promise<void> {
  await Promise.allSettled(
    remotes.map((remote) => git(root, ["fetch", remote, RELEASE_BRANCH, "--quiet"], 25_000))
  );
}

/**
 * What the running build is measured against: whichever copy of the release
 * branch contains the most. See `refs.ts` for why there is more than one.
 */
async function resolveLatestRef(root: string, remotes: string[]): Promise<string | null> {
  return pickMostAdvanced(
    releaseRefCandidates(remotes, RELEASE_BRANCH),
    (ref) => resolves(root, ref),
    async (from, to) => Number(await git(root, ["rev-list", "--count", `${from}..${to}`]))
  );
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

  const remotes = await listRemotes(root);
  await fetchAll(root, remotes);

  const ref = await resolveLatestRef(root, remotes);
  if (!ref) {
    status.error = `There is no ${RELEASE_BRANCH} branch here to compare against.`;
    return status;
  }
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
