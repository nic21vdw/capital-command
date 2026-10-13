import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export interface AtomicWriteOptions {
  space?: number | string;
  attempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
}

const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isTransientReplaceError(error: unknown): boolean {
  return TRANSIENT_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? "");
}

async function renameWithRetry(from: string, to: string, options: AtomicWriteOptions): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 8);
  const maxBackoff = options.maxBackoffMs ?? 400;
  let delay = options.backoffMs ?? 20;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isTransientReplaceError(error) || attempt >= attempts) throw error;
      await wait(delay);
      delay = Math.min(delay * 2, maxBackoff);
    }
  }
}

async function writeTemporary(tmp: string, data: string | Uint8Array): Promise<void> {
  const handle = await open(tmp, "wx");
  try {
    if (typeof data === "string") await handle.writeFile(data, "utf8");
    else await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function atomicWriteFile(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let swapped = false;
  try {
    await writeTemporary(tmp, data);
    await renameWithRetry(tmp, file, options);
    swapped = true;
  } finally {
    if (!swapped) await unlink(tmp).catch(() => undefined);
  }
}

export async function atomicWriteJson(file: string, value: unknown, options: AtomicWriteOptions = {}): Promise<void> {
  const text = JSON.stringify(value, null, options.space ?? 2);
  await atomicWriteFile(file, text, options);
}

export async function readJson<T = unknown>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}). It was left untouched.`);
  }
}
