import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
let writeQueue = Promise.resolve();

/**
 * Names whose value was already in the environment (from `.env`) when the saved
 * file was folded in, so the environment won and any Settings value for them is
 * ignored. Held on `globalThis` because the instrumentation hook that folds the
 * file in and the route handlers that report on it are bundled separately - a
 * module-level set in one would be empty in the other.
 */
const ENV_OWNED = Symbol.for("colateral.credentials.envOwned");

function envOwned(): Set<string> {
  const holder = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (holder[ENV_OWNED] ??= new Set<string>());
}

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
    if (process.env[key]?.trim()) envOwned().add(key);
    else process.env[key] = value;
  }
}

/** Where a credential's live value comes from. */
export type CredentialSource = "env" | "saved";

/**
 * Where each name's value comes from, or null when it has none. The
 * environment wins over the saved file on every start, so a value that `.env`
 * also sets reverts to the `.env` one after a restart whatever Settings saved -
 * which is why Settings has to say "set in .env" instead of offering to edit it.
 */
export async function credentialSources(
  names: readonly string[]
): Promise<Record<string, CredentialSource | null>> {
  const stored = await load();
  const owned = envOwned();
  const out: Record<string, CredentialSource | null> = {};
  for (const name of names) {
    if (stored[name] && !owned.has(name)) out[name] = "saved";
    else if (process.env[name]?.trim()) out[name] = "env";
    else out[name] = null;
  }
  return out;
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
  const requested = { ...updates };
  const save = async () => {
    // Queue the read together with the write: two connection forms can save
    // at once, and neither may replace the other's newly entered credentials.
    const current = { ...(await load()) };
    for (const [key, value] of Object.entries(requested)) {
      const trimmed = (value ?? "").trim();
      if (trimmed) current[key] = trimmed;
      else delete current[key];
    }

    await mkdir(dataRoot(), { recursive: true });
    const target = dataPath(FILE);
    const tmp = path.join(dataRoot(), `.${FILE}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }

    cache = current;
    for (const [key, value] of Object.entries(requested)) {
      if (value.trim()) process.env[key] = value.trim();
      else delete process.env[key];
    }
  };
  const saved = writeQueue.then(save, save);
  writeQueue = saved.then(() => undefined, () => undefined);
  await saved;
}
