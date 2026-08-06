import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
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

/**
 * What the running build is measured against.
 *
 * GitHub is a copy, not the source. Sandbox worktrees share this repository,
 * so work merged in one is in this .git before anything is uploaded — and
 * `update-app.ps1` will build exactly that. Watching only `origin/main` meant a
 * merge the app could already see and release reported as "up to date" for as
 * long as the upload was failing, which is precisely when someone is staring at
 * the banner wondering whether the update works at all.
 *
 * So: the remote ref when it is ahead, the local branch when it is.
 */
async function resolveLatestRef(root: string): Promise<string | null> {
  const remote = `origin/${RELEASE_BRANCH}`;
  const [hasRemote, hasLocal] = await Promise.all([resolves(root, remote), resolves(root, RELEASE_BRANCH)]);

  if (!hasRemote) return hasLocal ? RELEASE_BRANCH : null;
  if (!hasLocal) return remote;

  try {
    const ahead = await git(root, ["rev-list", "--count", `${remote}..${RELEASE_BRANCH}`]);
    return Number(ahead) > 0 ? RELEASE_BRANCH : remote;
  } catch {
    return remote;
  }
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
  // refs already here.
  try {
    await git(root, ["fetch", "origin", RELEASE_BRANCH, "--quiet"], 25_000);
  } catch {
    // Keep going with whatever origin/main was last known to be.
  }

  const ref = await resolveLatestRef(root);
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
