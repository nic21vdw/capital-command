/**
 * Which copy of the release branch is the one to measure against.
 *
 * This repository has MORE THAN ONE remote and they are not the same thing:
 *
 *  - `github` is where work lands. Agent sessions open pull requests and merge
 *    them there, so it is the first place a finished change exists.
 *  - `origin` is a local bare repository under `C:\Users\nic21\GitOrigin`, the
 *    backup hub for every one of Nic's repos. `backup-to-github.ps1` pulls
 *    GitHub down into it on a schedule, so it FOLLOWS GitHub rather than
 *    leading it — and the production release pushes its changelog commit
 *    there, which is the one thing that ever moves it first.
 *
 * Watching only one of them is wrong in both directions: only `origin` and a
 * merged pull request stays invisible until the nightly backup runs, only
 * `github` and a release made while the network was down looks like it never
 * happened. So every remote is a candidate, and so is the local branch — a
 * sandbox worktree shares this repository, so a merge in one is in this `.git`
 * before it is uploaded anywhere.
 *
 * The comparison is by ancestry, not by date: a clock is not evidence of what
 * contains what.
 */

export type RefExists = (ref: string) => Promise<boolean>;

/** How many commits `to` has that `from` does not. */
export type AheadCount = (from: string, to: string) => Promise<number>;

/**
 * Every ref worth comparing, remotes first.
 *
 * Remotes lead so that a remote which merely EQUALS the local branch wins the
 * tie. Releasing `github/main` when the local `main` is identical means the
 * release is described in terms of where the work actually lives, and the two
 * resolve to the same commit anyway.
 */
export function releaseRefCandidates(remotes: string[], branch: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const remote of remotes) {
    const ref = `${remote}/${branch}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    candidates.push(ref);
  }
  if (!seen.has(branch)) candidates.push(branch);
  return candidates;
}

/**
 * The candidate that contains the most, or null when none of them resolve.
 *
 * A candidate only displaces the current best when it is STRICTLY ahead of it,
 * so equal refs keep the earlier one and the order above decides ties. A
 * comparison that cannot be made — unrelated histories, a ref that vanished
 * between resolving and counting — leaves the best where it is rather than
 * taking the newcomer on faith.
 */
export async function pickMostAdvanced(
  candidates: string[],
  exists: RefExists,
  aheadCount: AheadCount
): Promise<string | null> {
  let best: string | null = null;

  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    try {
      if ((await aheadCount(best, candidate)) > 0) best = candidate;
    } catch {
      // Keep what we have.
    }
  }

  return best;
}
