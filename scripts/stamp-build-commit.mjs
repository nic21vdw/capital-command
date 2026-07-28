import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Records the commit a production build came from, as `.next/BUILD_COMMIT`.
 *
 * `BUILD_ID` is random, so nothing in the build says which code is actually
 * being served. Merging a fix does not redeploy it, and a scheduled run that
 * starts the app from a stale `.next` runs yesterday's code while `main` says
 * otherwise — which is exactly how a merged carousel fix nearly missed a 6am
 * scan. `daily-channel-scan.ps1` compares this against `git rev-parse HEAD`
 * and rebuilds when they differ.
 *
 * Lives inside `.next` on purpose: clearing the build clears the stamp, so a
 * wiped `.next` reads as "unknown" rather than as whatever was built last.
 */

const nextDir = join(process.cwd(), ".next");

// BUILD_ID is the artifact that says a build actually finished. `next build`
// has exited 0 here without producing one — a concurrent build sharing this
// .next, or OneDrive taking a file mid-trace — and stamping that would claim a
// commit is deployed when nothing is. Not an error: postbuild also runs after
// a failed build, and failing here would mask the real failure.
if (!existsSync(nextDir) || !existsSync(join(nextDir, "BUILD_ID"))) {
  console.log("[stamp] no completed build to stamp — leaving .next/BUILD_COMMIT alone.");
  process.exit(0);
}

let commit;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // No git, or not a checkout (a copied folder, a release archive). The scan
  // treats a missing stamp as "cannot tell" and leaves the build alone rather
  // than rebuilding on every run.
  console.log("[stamp] no git commit available — leaving .next/BUILD_COMMIT unwritten.");
  process.exit(0);
}

writeFileSync(join(nextDir, "BUILD_COMMIT"), `${commit}\n`, "utf8");
console.log(`[stamp] built from ${commit.slice(0, 12)}`);
