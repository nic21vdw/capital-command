import { execFileSync, spawnSync } from "node:child_process";

const base = process.env.TEST_CHANGED_BASE || "origin/main";
const extra = process.argv.slice(2);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

let since;
try {
  since = git(["merge-base", base, "HEAD"]);
} catch {
  console.error(`[test:changed] cannot find a merge base with ${base}. Fetch it first: git fetch origin main`);
  process.exit(2);
}

const vitest = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["vitest", "run", "--changed", since, "--passWithNoTests", ...extra];
console.log(`[test:changed] specs related to files changed since ${base} (${since.slice(0, 10)})`);
const result = spawnSync(vitest, args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
