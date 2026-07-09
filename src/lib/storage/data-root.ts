import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Resolves where app data lives. By default everything is written under
 * ./data, but the user can point the workspace at any folder — typically one
 * their own cloud client already syncs (Dropbox, OneDrive, Google Drive) so
 * the same workspace follows them across machines without the app talking to
 * any cloud API ("bring your own storage").
 *
 * The pointer lives in config/storage.json (part of the app install, never
 * inside the workspace itself, so a synced workspace stays portable). Reads
 * are cached and invalidated by the config file's mtime, so a workspace move
 * takes effect without restarting the server.
 */

const CONFIG_PATH = path.join(process.cwd(), "config", "storage.json");
const DEFAULT_ROOT = path.join(process.cwd(), "data");

type StorageConfig = { workspaceRoot?: string | null };

let cached: { root: string; mtimeMs: number } | null = null;

function readConfiguredRoot(): string {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cached = null;
    return DEFAULT_ROOT;
  }
  if (cached && cached.mtimeMs === mtimeMs) return cached.root;
  let root = DEFAULT_ROOT;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as StorageConfig;
    if (typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot.trim() && path.isAbsolute(parsed.workspaceRoot)) {
      root = parsed.workspaceRoot;
    }
  } catch {
    // Unreadable config falls back to the default location rather than failing every request.
  }
  cached = { root, mtimeMs };
  return root;
}

/** Root folder for all user data (the workspace). May live in a cloud-synced folder. */
export function getDataRoot(): string {
  return readConfiguredRoot();
}

/**
 * Root for machine-specific caches (yt-dlp binaries, Whisper models). Always
 * the local ./data folder: binaries are per-platform and would waste cloud
 * quota, so they never travel with the workspace.
 */
export function getLocalCacheRoot(): string {
  return DEFAULT_ROOT;
}

/** Where the workspace pointer is stored, for status/display purposes. */
export function storageConfigPath(): string {
  return CONFIG_PATH;
}

/** The built-in default workspace location (./data). */
export function defaultDataRoot(): string {
  return DEFAULT_ROOT;
}
