/**
 * The half of the release check that the banner needs and the browser can
 * have. It is a separate file because it has to be: `status.ts` reads git and
 * the filesystem, and importing so much as a type from it drags `node:util`
 * into the client bundle and fails the production build.
 */

// Type-only, so nothing from the server half is emitted into the client
// bundle - the whole reason this file is separate.
import type { ReleaseProgress } from "@/lib/release/progress";

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

/**
 * Where finished work waits. Agent sessions open pull requests against `main`
 * and merge them there, so `main` — not `dev` — is what the running build is
 * behind. Watching `dev` meant the banner stayed silent through six releases'
 * worth of shipped work.
 */
export const RELEASE_BRANCH = "main";
export const PRODUCTION_BRANCH = "main";

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

/**
 * Whether the banner belongs on screen. Kept out of the component because
 * every way of getting this wrong is silent: a banner in the sandbox invites a
 * release from the wrong checkout, one that outlives its own release nags
 * about work already running, and one that respects a stale dismissal hides
 * the next release forever.
 */
export function shouldShowBanner(
  status: Pick<ReleaseStatus, "releasable" | "pending" | "latest"> | null,
  { dismissed, busy }: { dismissed?: string | null; busy?: boolean } = {}
): boolean {
  if (!status?.releasable) return false;
  // Mid-release the banner IS the progress indicator, so it stays regardless
  // of what the last poll said was pending.
  if (busy) return true;
  if (!status.pending.length) return false;
  // Dismissal lasts until the next commit lands, not forever.
  return !(dismissed && dismissed === status.latest);
}

/**
 * What the sidebar's "Check for updates" button is currently saying.
 *
 * Same reasoning as `shouldShowBanner`: a button that answers "am I on the
 * latest?" is only worth having if the answer is right, and the two ways of
 * being wrong are both quiet. Claiming "up to date" before any check has come
 * back reassures Nic about a question nothing has asked yet, and claiming it
 * in a sandbox — which cannot compare itself to a release and cannot perform
 * one — reassures him about the wrong checkout entirely.
 */
export type UpdateCheckState =
  | "unknown"
  | "checking"
  | "updating"
  | "available"
  | "up-to-date"
  | "elsewhere";

export function updateCheckState(
  status: Pick<ReleaseStatus, "releasable" | "pending"> | null,
  phase: "idle" | "checking" | "starting" | "updating"
): UpdateCheckState {
  if (phase === "starting" || phase === "updating") return "updating";
  if (phase === "checking") return "checking";
  if (!status) return "unknown";
  if (!status.releasable) return "elsewhere";
  return status.pending.length ? "available" : "up-to-date";
}

/**
 * Whether a release is still going, from what it has written down.
 *
 * A boolean held in the server process is not enough on its own, and getting
 * this wrong is not cosmetic: the flag is set when a release starts and only
 * ever cleared by the release killing the server. A release that stopped on an
 * error never kills it, so the app went on saying "updating" and answering
 * every retry with "an update is already running" — for as long as it stayed
 * up, with no way back except restarting it by hand.
 *
 * So a release that has written a reason it stopped, or the line it ends a
 * good run with, is over. So is one that has gone quiet for longer than any
 * step legitimately takes.
 */
export const RELEASE_ABANDONED_AFTER_SECONDS = 900;

export function releaseStillRunning(
  startedHere: boolean,
  progress: Pick<ReleaseProgress, "failed" | "finished" | "quietFor">
): boolean {
  if (!startedHere) return false;
  if (progress.failed || progress.finished) return false;
  if (progress.quietFor !== null && progress.quietFor > RELEASE_ABANDONED_AFTER_SECONDS) return false;
  return true;
}
