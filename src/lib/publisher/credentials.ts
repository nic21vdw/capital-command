import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath, dataRoot } from "@/lib/paths";

/**
 * Credentials the owner of this install entered, kept beside their data.
 *
 * Every platform key used to come from `.env` and nowhere else, so connecting
 * an account meant opening a file in an editor, pasting a client id and secret,
 * and restarting the server - before any of the in-app OAuth buttons would do
 * anything. That is a developer's setup step standing in front of a product.
 *
 * This file is the same values, written by Settings into `data\credentials.json`
 * and read alongside `process.env`. The environment still wins: a machine that
 * sets a variable deliberately - a CI run, a scheduled task with its own
 * environment - must not be overridden by a file, and the existing `.env`
 * installs keep working untouched.
 *
 * It lives in `data\`, which is gitignored and is the folder the app already
 * treats as private, and it is never sent to the browser: Settings shows
 * whether a key is set, never what it is.
 */

const FILE = "credentials.json";

let cache: Record<string, string> | null = null;

/** Forget the cached file, so the next read sees what Settings just wrote. */
export function forgetCredentials() {
  cache = null;
}

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const raw = await readFile(dataPath(FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const out: Record<string, string> = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) out[key] = value.trim();
      }
    }
    cache = out;
  } catch {
    // No file, unreadable file, or a file that is not an object. All three mean
    // the same thing to a caller - nothing was entered - and none of them is a
    // reason to stop the app booting.
    cache = {};
  }
  return cache;
}

/**
 * Pull the stored credentials into `process.env` for the names that are not
 * already set there. Called once before anything reads config, because every
 * reader in this codebase reads `process.env` and rewriting all of them to go
 * through an async accessor would be a far larger change than the problem.
 */
export async function applyStoredCredentials() {
  const stored = await load();
  for (const [key, value] of Object.entries(stored)) {
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

/** Which of these names have a value, from either source. Never the values. */
export async function credentialsPresent(names: readonly string[]): Promise<Record<string, boolean>> {
  const stored = await load();
  const out: Record<string, boolean> = {};
  for (const name of names) {
    out[name] = Boolean(process.env[name]?.trim() || stored[name]);
  }
  return out;
}

/**
 * Save what Settings entered. A name with an empty value is removed rather
 * than stored blank, so clearing a field in the UI actually disconnects rather
 * than leaving an empty string that reads as "set" to every `str()` in config.
 *
 * Written through a temporary file and renamed, the way the app document is:
 * a half-written credentials file is a file that parses to nothing and takes
 * every connected account down with it.
 */
export async function saveCredentials(updates: Record<string, string>) {
  const current = { ...(await load()) };
  for (const [key, value] of Object.entries(updates)) {
    const trimmed = (value ?? "").trim();
    if (trimmed) current[key] = trimmed;
    else delete current[key];
  }

  await mkdir(dataRoot(), { recursive: true });
  const target = dataPath(FILE);
  const tmp = path.join(dataRoot(), `.${FILE}.tmp`);
  await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
  await rename(tmp, target);

  cache = current;
  for (const [key, value] of Object.entries(updates)) {
    if (value.trim()) process.env[key] = value.trim();
    else delete process.env[key];
  }
}
