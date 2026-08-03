import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const nextDir = join(process.cwd(), ".next");
const projectNodeModules = join(process.cwd(), "node_modules");

/**
 * Only a checkout inside the synced folder needs .next moved out of it —
 * OneDrive locking build output mid-write is the whole reason this exists. A
 * sandbox worktree under %USERPROFILE% has no such problem, and relocating its
 * build output is not free: emitted files then resolve `react` from wherever
 * the temp folder's parents lead, which is how a build ended up with two
 * copies of React and died prerendering /404.
 */
const insideSyncedFolder = /[\\/]onedrive[\\/]/i.test(process.cwd());

/** Everything this checkout keeps outside the synced folder, in one place. */
const checkoutCache =
  process.env.CAPITAL_COMMAND_NEXT_CACHE_DIR ||
  join(
    process.env.TEMP || process.env.TMP || tmpdir() || process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    "capital-command",
    "next-dev-cache",
    `${basename(process.cwd())}-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8)}`
  );
const cacheRoot = join(checkoutCache, ".next");
// A sibling of the relocated .next, inside this checkout's own folder. It has
// to be a sibling rather than a child because `next build` empties .next
// before it starts, and it has to be per-checkout because the old shared link
// one level up was repointed by whichever checkout ran this script last —
// every other one then resolved React through a stranger's node_modules. Two
// Reacts in a bundle prerenders as "Cannot read properties of null (reading
// 'useContext')", and a build that survives it serves a page whose client
// never hydrates: every button dead.
const cacheNodeModules = join(checkoutCache, "node_modules");
const legacySharedNodeModules = join(checkoutCache, "..", "node_modules");
const routesManifest = join(nextDir, "routes-manifest.json");
const fallbackRoutesManifest = {
  version: 3,
  caseSensitive: false,
  basePath: "",
  rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
  redirects: [
    {
      source: "/:path+/",
      destination: "/:path+",
      permanent: true,
      internal: true,
      regex: "^(?:\\/((?:[^\\/]+?)(?:\\/(?:[^\\/]+?))*))\\/$"
    }
  ],
  headers: []
};

function writeRoutesManifest() {
  mkdirSync(nextDir, { recursive: true });
  writeFileSync(routesManifest, `${JSON.stringify(fallbackRoutesManifest)}\n`);
  console.log("Repaired missing Next.js routes manifest.");
}

// A link left by an older version of this script points somewhere else, and
// reusing it silently is worse than not linking at all: the build writes to
// the old location while the dependency link is created beside the new one, and
// the server starts up unable to find react/jsx-runtime. So the target has to
// match, not merely exist.
function isLinkedCache() {
  try {
    if (!existsSync(nextDir) || !lstatSync(nextDir).isSymbolicLink()) return false;
    return realpathSync(nextDir) === realpathSync(cacheRoot);
  } catch {
    return false;
  }
}

function removeCacheContents() {
  mkdirSync(cacheRoot, { recursive: true });
  for (const entry of readdirSync(cacheRoot)) {
    rmSync(join(cacheRoot, entry), { recursive: true, force: true });
  }
}

function isLinkedPath(filePath) {
  try {
    return existsSync(filePath) && lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function pointsAtThisCheckout(link) {
  try {
    return realpathSync(link) === realpathSync(projectNodeModules);
  } catch {
    return false;
  }
}

function ensureDependencyLookup() {
  if (!existsSync(projectNodeModules)) return;

  // Whatever another checkout left behind. Removing it is the point: while it
  // exists, module resolution from this cache folder can still climb into it.
  if (isLinkedPath(legacySharedNodeModules)) {
    rmSync(legacySharedNodeModules, { recursive: true, force: true });
  }

  if (isLinkedPath(cacheNodeModules) && pointsAtThisCheckout(cacheNodeModules)) return;
  if (existsSync(cacheNodeModules)) {
    rmSync(cacheNodeModules, { recursive: true, force: true });
  }
  symlinkSync(projectNodeModules, cacheNodeModules, "junction");
}

function linkNextCache() {
  if (isLinkedCache()) {
    removeCacheContents();
    ensureDependencyLookup();
    console.log(`Cleared local Next.js cache at ${cacheRoot}.`);
    return;
  }

  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }

  mkdirSync(cacheRoot, { recursive: true });
  ensureDependencyLookup();
  symlinkSync(cacheRoot, nextDir, "junction");
  console.log(`Using local Next.js cache outside the synced folder: ${cacheRoot}`);
}

try {
  if (!insideSyncedFolder) {
    // Leave a relocated cache from an earlier run behind rather than building
    // half in and half out of it - wherever that older link happens to point.
    if (isLinkedPath(nextDir)) rmSync(nextDir, { recursive: true, force: true });
    if (isLinkedPath(legacySharedNodeModules)) {
      rmSync(legacySharedNodeModules, { recursive: true, force: true });
    }
    console.log("Building in place: this checkout is not in a synced folder.");
    process.exit(0);
  }
  linkNextCache();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Could not move .next cache out of the project folder: ${message}`);
  writeRoutesManifest();
}
