import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { atomicWriteFile } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import { publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";

/**
 * Tiny persisted key/value cache for OAuth tokens that rotate server-side
 * (TikTok can return a NEW refresh token on every refresh; losing it would
 * strand the integration until the user re-authorizes). Values live next to
 * the queue: a local JSON file by default, or an object in the R2 bucket when
 * the queue backend is r2 so GitHub Actions runs share the same rotation.
 *
 * .env values act as the initial seed; a cached value always wins after that.
 *
 * Every write re-reads the whole store and writes it back, so a read that
 * fails must stop the write: only a file that does not exist is an empty store.
 * A read that hits a lock (EBUSY, EPERM, EACCES: a scanner or a sync client
 * holding the file for a moment) is tried again up to five times with a short
 * backoff; any other failure, or a lock that does not clear, throws and leaves
 * the file exactly as it was. Reads are forgiving and answer "no
 * token", so a post fails as not connected instead of crashing.
 */

const FILE_PATH = dataPath("publisher-tokens.json");
const R2_KEY = "publisher/tokens.json";

type Store = Record<string, string>;

const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const READ_ATTEMPTS = 5;
const READ_BACKOFF_MS = 25;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readFileWithRetry(): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await readFile(FILE_PATH, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!LOCK_CODES.has(code) || attempt >= READ_ATTEMPTS) throw error;
      await pause(READ_BACKOFF_MS * attempt);
    }
  }
}

function parseStore(text: string): Store {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("publisher-tokens.json is not valid JSON, so it was left untouched.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("publisher-tokens.json does not hold a JSON object, so it was left untouched.");
  }
  return parsed as Store;
}

async function readStrict(): Promise<Store> {
  const config = publisherConfig();
  if (config.queueBackend === "r2") {
    const host = mediaHost(config);
    const text = host ? await host.getObjectText(R2_KEY) : null;
    return text ? parseStore(text) : {};
  }
  let text: string;
  try {
    text = await readFileWithRetry();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseStore(text);
}

async function writeAll(values: Store): Promise<void> {
  const config = publisherConfig();
  const text = JSON.stringify(values, null, 2);
  if (config.queueBackend === "r2") {
    const host = mediaHost(config);
    if (host) {
      await host.putObjectText(R2_KEY, text);
      return;
    }
  }
  await atomicWriteFile(FILE_PATH, text);
}

let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (publisherConfig().queueBackend !== "r2") return withFileLock(FILE_PATH, work);
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export async function getCachedToken(key: string): Promise<string | null> {
  try {
    return (await readStrict())[key] ?? null;
  } catch {
    return null;
  }
}

export type TokenUpdate<T> = { set: Record<string, string>; result: T };

export function updateCachedTokens<T>(update: (current: Readonly<Store>) => TokenUpdate<T>): Promise<T> {
  return exclusive(async () => {
    const values = await readStrict();
    const { set, result } = update(values);
    const next = { ...values };
    let changed = false;
    for (const [key, value] of Object.entries(set)) {
      if (next[key] === value) continue;
      next[key] = value;
      changed = true;
    }
    if (changed) await writeAll(next);
    return result;
  });
}

export async function setCachedTokens(entries: Record<string, string>): Promise<void> {
  await updateCachedTokens(() => ({ set: entries, result: undefined }));
}

export async function setCachedToken(key: string, value: string): Promise<void> {
  await setCachedTokens({ [key]: value });
}
