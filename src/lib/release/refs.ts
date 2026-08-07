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

/**
 * How the two refs stand relative to each other, in one measurement:
 * `ahead` is what `to` has that `from` does not, `behind` is the reverse.
 * `git rev-list --left-right --count from...to` answers both at once.
 */
export type AheadBehind = (from: string, to: string) => Promise<{ ahead: number; behind: number }>;

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
 * The candidate that carries the most work, or null when none of them resolve.
 *
 * "Ahead" alone is not the test, and getting that wrong is not theoretical: the
 * two remotes here DIVERGE routinely — GitHub collects merged pull requests
 * while the release pushes its changelog commit to the backup — so both sides
 * hold commits the other lacks. A rule that swapped on any unique commit
 * picked whichever was compared last, and the app reported "up to date" with
 * five merged pull requests sitting on GitHub.
 *
 * So a candidate must carry MORE unique work than the best so far. That one
 * comparison covers every case: strictly ahead wins, strictly behind loses,
 * equal keeps the earlier candidate, and a genuine fork goes to whichever side
 * has more on it.
 */
export async function pickMostAdvanced(
  candidates: string[],
  exists: RefExists,
  compare: AheadBehind
): Promise<string | null> {
  let best: string | null = null;

  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    try {
      const { ahead, behind } = await compare(best, candidate);
      if (ahead > behind) best = candidate;
    } catch {
      // A comparison that cannot be made leaves the best where it is, rather
      // than taking the newcomer on faith.
    }
  }

  return best;
}
