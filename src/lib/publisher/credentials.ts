import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";

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

export class CredentialStoreReadError extends Error {
  constructor() {
    super("The saved credentials could not be read safely. Repair the credential store before saving credentials.");
  }
}

/** A recovery save must preserve the fresh, complete store or refuse it. */
async function loadStrict(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(dataPath(FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new CredentialStoreReadError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialStoreReadError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "string" || !value.trim())) {
    throw new CredentialStoreReadError();
  }
  // Preserve unrelated names and values exactly. Neither a rejected read nor
  // validation changes the tolerant read cache or the live environment.
  return parsed as Record<string, string>;
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
 *
 * Threads recovery opts into strict mode: an absent file may be initialized,
 * but an unreadable or invalid store must never be overwritten as empty.
 */
export async function saveCredentials(updates: Record<string, string>, options: { strict?: boolean } = {}) {
  const requested = { ...updates };
  const strict = options.strict === true;
  const save = async () => {
    // Queue the read together with the write: two connection forms can save
    // at once, and neither may replace the other's newly entered credentials.
    // Strict reads must happen here, after earlier queued saves finish. A
    // cached or pre-queued snapshot can drop another connection's new values.
    const current = { ...(strict ? await loadStrict() : await load()) };
    for (const [key, value] of Object.entries(requested)) {
      const trimmed = (value ?? "").trim();
      if (trimmed) current[key] = trimmed;
      else delete current[key];
    }

    await atomicWriteJson(dataPath(FILE), current);

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
