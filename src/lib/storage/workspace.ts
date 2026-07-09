import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultDataRoot, getDataRoot, storageConfigPath } from "@/lib/storage/data-root";

/**
 * Bring-your-own-storage workspace management.
 *
 * The workspace is one self-contained folder. To sync across devices the user
 * moves it into a folder their own cloud client already syncs (Dropbox,
 * OneDrive, Google Drive); the cloud client does the syncing and this app
 * never talks to any cloud API. Everything here is plain filesystem work:
 * detect likely cloud folders, copy the workspace, point the config at it.
 */

export const WORKSPACE_MARKER = ".capital-command-workspace.json";
const WORKSPACE_SCHEMA_VERSION = 1;

/** Machine-local cache dirs that must not travel with the workspace. */
const LOCAL_ONLY_DIRS = new Set(["clips/bin"]);

export type CloudProvider = "Dropbox" | "OneDrive" | "Google Drive";

export type CloudRoot = { provider: CloudProvider; path: string };

export type WorkspaceStatus = {
  root: string;
  isDefault: boolean;
  defaultRoot: string;
  configPath: string;
  markerPresent: boolean;
  cloudRoots: CloudRoot[];
  /** Which cloud folder (if any) the current workspace lives inside. */
  syncedVia: CloudProvider | null;
  conflictFiles: string[];
};

async function isDir(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort detection of cloud-synced folders on this machine. Purely
 * local checks (env vars, well-known paths, Dropbox's info.json) — no network.
 */
export async function detectCloudRoots(): Promise<CloudRoot[]> {
  const home = os.homedir();
  const candidates: Array<{ provider: CloudProvider; path: string }> = [];

  // Dropbox writes its actual folder location to info.json.
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA, path.join(home, ".dropbox")]) {
    if (!base) continue;
    try {
      const raw = await readFile(path.join(base, "Dropbox", "info.json"), "utf8").catch(() =>
        readFile(path.join(base, "info.json"), "utf8")
      );
      const info = JSON.parse(raw) as Record<string, { path?: string }>;
      for (const account of Object.values(info)) {
        if (account?.path) candidates.push({ provider: "Dropbox", path: account.path });
      }
    } catch {
      // No Dropbox client config here.
    }
  }
  candidates.push({ provider: "Dropbox", path: path.join(home, "Dropbox") });

  // OneDrive publishes its roots through environment variables on Windows.
  for (const envVar of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
    const value = process.env[envVar];
    if (value) candidates.push({ provider: "OneDrive", path: value });
  }
  candidates.push({ provider: "OneDrive", path: path.join(home, "OneDrive") });

  // Google Drive: desktop app mounts under CloudStorage on macOS; classic
  // folder names elsewhere.
  candidates.push({ provider: "Google Drive", path: path.join(home, "Google Drive") });
  candidates.push({ provider: "Google Drive", path: path.join(home, "GoogleDrive") });
  try {
    const cloudStorage = path.join(home, "Library", "CloudStorage");
    for (const entry of await readdir(cloudStorage)) {
      if (entry.startsWith("GoogleDrive-")) candidates.push({ provider: "Google Drive", path: path.join(cloudStorage, entry, "My Drive") });
      if (entry.startsWith("OneDrive-")) candidates.push({ provider: "OneDrive", path: path.join(cloudStorage, entry) });
      if (entry.startsWith("Dropbox")) candidates.push({ provider: "Dropbox", path: path.join(cloudStorage, entry) });
    }
  } catch {
    // Not macOS or no CloudStorage mounts.
  }

  const found: CloudRoot[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate.path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (await isDir(normalized)) found.push({ provider: candidate.provider, path: normalized });
  }
  return found;
}

/**
 * Filename patterns cloud clients use when two devices edited the same file:
 * Dropbox "x (conflicted copy ...)", OneDrive "x-DESKTOP-ABC123", Google
 * Drive/generic "x (1)". Only JSON-ish workspace files are checked for the
 * numeric pattern to avoid flagging ordinary media names.
 */
export function isConflictCopyName(name: string): boolean {
  if (/\(conflicted copy/i.test(name)) return true;
  if (/\(.*conflict.*\)/i.test(name)) return true;
  if (/ \(\d+\)\.(json|jsonl)$/i.test(name)) return true;
  return false;
}

const CONFLICT_SCAN_SKIP = new Set(["node_modules", "bin", ".git"]);
const CONFLICT_SCAN_MAX_DEPTH = 4;

/** Scans the workspace for cloud-client conflict copies. Non-fatal, best-effort. */
export async function findConflictCopies(root = getDataRoot()): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > CONFLICT_SCAN_MAX_DEPTH || hits.length >= 50) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!CONFLICT_SCAN_SKIP.has(entry.name)) await walk(path.join(dir, entry.name), depth + 1);
      } else if (isConflictCopyName(entry.name)) {
        hits.push(path.relative(root, path.join(dir, entry.name)));
      }
    }
  }
  await walk(root, 0);
  return hits;
}

async function writeMarker(root: string) {
  const markerPath = path.join(root, WORKSPACE_MARKER);
  if (await exists(markerPath)) return;
  await writeFile(
    markerPath,
    JSON.stringify({ app: "capital-command", schemaVersion: WORKSPACE_SCHEMA_VERSION, createdAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

async function writeStorageConfig(workspaceRoot: string | null) {
  const configPath = storageConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify({ workspaceRoot }, null, 2), "utf8");
  await rename(tmpPath, configPath);
}

function assertSafeTarget(target: string, current: string) {
  if (!path.isAbsolute(target)) throw new Error("Workspace path must be absolute.");
  const resolvedTarget = path.resolve(target);
  const resolvedCurrent = path.resolve(current);
  if (resolvedTarget === resolvedCurrent) throw new Error("That is already the current workspace folder.");
  const rel = path.relative(resolvedCurrent, resolvedTarget);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error("The new workspace cannot be inside the current one.");
  }
  const relBack = path.relative(resolvedTarget, resolvedCurrent);
  if (relBack && !relBack.startsWith("..") && !path.isAbsolute(relBack)) {
    throw new Error("The new workspace cannot contain the current one.");
  }
  return resolvedTarget;
}

async function countFiles(root: string, skipLocalOnly: boolean): Promise<number> {
  let count = 0;
  async function walk(dir: string, relBase: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (skipLocalOnly && LOCAL_ONLY_DIRS.has(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && !entry.name.endsWith(".tmp")) count += 1;
    }
  }
  await walk(root, "");
  return count;
}

/**
 * Copies the current workspace into `target`, verifies the copy, then points
 * the app at it. The old copy is never deleted — the user removes it once
 * they have confirmed everything is in place.
 */
export async function moveWorkspace(target: string): Promise<{ root: string; filesCopied: number }> {
  const current = getDataRoot();
  const resolvedTarget = assertSafeTarget(target, current);

  if (await exists(resolvedTarget)) {
    const entries = await readdir(resolvedTarget);
    const meaningful = entries.filter((name) => name !== WORKSPACE_MARKER && !name.startsWith("."));
    if (meaningful.length > 0) {
      throw new Error(
        "The target folder is not empty. Pick an empty (or new) folder, or use \"Open existing workspace\" to adopt a folder that already holds a workspace."
      );
    }
  }

  await mkdir(resolvedTarget, { recursive: true });
  await cp(current, resolvedTarget, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => {
      const rel = path.relative(current, source).split(path.sep).join("/");
      if (!rel) return true;
      for (const localOnly of LOCAL_ONLY_DIRS) {
        if (rel === localOnly || rel.startsWith(`${localOnly}/`)) return false;
      }
      return !rel.endsWith(".tmp");
    }
  }).catch(async (error: NodeJS.ErrnoException) => {
    // A brand-new workspace may have no data folder yet; that is fine.
    if (error.code !== "ENOENT") throw error;
  });

  const expected = (await exists(current)) ? await countFiles(current, true) : 0;
  const copied = await countFiles(resolvedTarget, false);
  if (copied < expected) {
    throw new Error(`Copy verification failed: expected ${expected} files, found ${copied}. The app still uses the old location.`);
  }

  await writeMarker(resolvedTarget);
  await writeStorageConfig(resolvedTarget);
  return { root: resolvedTarget, filesCopied: copied };
}

/**
 * Points the app at a folder that already contains a workspace (identified by
 * its marker file) — e.g. a cloud-synced workspace created on another machine.
 */
export async function adoptWorkspace(target: string): Promise<{ root: string }> {
  const current = getDataRoot();
  const resolvedTarget = assertSafeTarget(target, current);
  if (!(await isDir(resolvedTarget))) throw new Error("That folder does not exist.");
  if (!(await exists(path.join(resolvedTarget, WORKSPACE_MARKER)))) {
    throw new Error(
      `No workspace found there: the folder has no ${WORKSPACE_MARKER} marker. Use "Move workspace" to create a new workspace in an empty folder.`
    );
  }
  await writeStorageConfig(resolvedTarget);
  return { root: resolvedTarget };
}

/** Reverts to the built-in ./data location. Nothing is copied or deleted. */
export async function resetWorkspaceToDefault(): Promise<{ root: string }> {
  await writeStorageConfig(null);
  return { root: defaultDataRoot() };
}

export async function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  const root = getDataRoot();
  const defaultRoot = defaultDataRoot();
  const [markerPresent, cloudRoots, conflictFiles] = await Promise.all([
    exists(path.join(root, WORKSPACE_MARKER)),
    detectCloudRoots(),
    findConflictCopies(root)
  ]);
  const resolvedRoot = path.resolve(root);
  const syncedVia =
    cloudRoots.find((cloud) => {
      const rel = path.relative(cloud.path, resolvedRoot);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    })?.provider ?? null;
  return {
    root: resolvedRoot,
    isDefault: resolvedRoot === path.resolve(defaultRoot),
    defaultRoot: path.resolve(defaultRoot),
    configPath: storageConfigPath(),
    markerPresent,
    cloudRoots,
    syncedVia,
    conflictFiles
  };
}
