import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const nextDir = join(process.cwd(), ".next");
const projectNodeModules = join(process.cwd(), "node_modules");
const cacheRoot =
  process.env.CAPITAL_COMMAND_NEXT_CACHE_DIR ||
  join(
    process.env.TEMP || process.env.TMP || tmpdir() || process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    "capital-command",
    "next-dev-cache",
    `${basename(process.cwd())}-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8)}`
  );
const cacheNodeModules = join(cacheRoot, "..", "node_modules");
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

function isLinkedCache() {
  try {
    return existsSync(nextDir) && lstatSync(nextDir).isSymbolicLink();
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

function ensureDependencyLookup() {
  if (!existsSync(projectNodeModules) || isLinkedPath(cacheNodeModules)) return;
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
  linkNextCache();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Could not move .next cache out of the project folder: ${message}`);
  writeRoutesManifest();
}
