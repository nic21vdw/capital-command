import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface FileLockOptions {
  staleMs?: number;
  timeoutMs?: number;
  retryMs?: number;
}

interface LockRecord {
  pid: number;
  token: string;
  acquiredAt: string;
}

interface LockReading {
  record: LockRecord | null;
  ageMs: number;
}

interface HeldLock {
  lockPath: string;
  token: string;
}

export const DEFAULT_LOCK_STALE_MS = 30_000;
export const DEFAULT_LOCK_TIMEOUT_MS = 45_000;
const DEFAULT_LOCK_RETRY_MS = 15;
const BREAK_GATE_STALE_MS = 10_000;

export class FileLockTimeoutError extends Error {
  constructor(
    readonly target: string,
    readonly holderPid: number | null,
    readonly waitedMs: number
  ) {
    super(
      `Timed out after ${waitedMs} ms waiting for the lock on ${path.basename(target)}, held by ${
        holderPid === null ? "an unknown process" : `process ${holderPid}`
      }.`
    );
    this.name = "FileLockTimeoutError";
  }
}

export function lockFilePath(target: string): string {
  return `${target}.lock`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<LockReading | null> {
  try {
    const [raw, info] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    const fileAge = Math.max(0, Date.now() - info.mtimeMs);
    try {
      const parsed = JSON.parse(raw) as Partial<LockRecord>;
      if (typeof parsed.pid === "number" && typeof parsed.token === "string") {
        const acquired = Date.parse(parsed.acquiredAt ?? "");
        return {
          record: { pid: parsed.pid, token: parsed.token, acquiredAt: parsed.acquiredAt ?? "" },
          ageMs: Number.isFinite(acquired) ? Math.max(0, Date.now() - acquired) : fileAge
        };
      }
    } catch {
      return { record: null, ageMs: fileAge };
    }
    return { record: null, ageMs: fileAge };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isStale(reading: LockReading, staleMs: number): boolean {
  if (reading.ageMs > staleMs) return true;
  return reading.record !== null && !processAlive(reading.record.pid);
}

export async function isLockHeld(target: string, staleMs = DEFAULT_LOCK_STALE_MS): Promise<boolean> {
  try {
    const reading = await readLock(lockFilePath(target));
    return reading !== null && !isStale(reading, staleMs);
  } catch {
    return true;
  }
}

async function breakStale(lockPath: string, seen: LockReading, staleMs: number): Promise<void> {
  const gatePath = `${lockPath}.break`;
  let gate;
  try {
    gate = await open(gatePath, "wx");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
    const info = await stat(gatePath).catch(() => null);
    if (info && Date.now() - info.mtimeMs > BREAK_GATE_STALE_MS) await unlink(gatePath).catch(() => undefined);
    await wait(DEFAULT_LOCK_RETRY_MS);
    return;
  }
  try {
    const current = await readLock(lockPath).catch(() => null);
    if (current && current.record?.token === seen.record?.token && isStale(current, staleMs)) {
      await unlink(lockPath).catch(() => undefined);
    }
  } finally {
    await gate.close().catch(() => undefined);
    await unlink(gatePath).catch(() => undefined);
  }
}

async function tryCreate(lockPath: string, token: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "EBUSY") return false;
    throw error;
  }
  try {
    const record: LockRecord = { pid: process.pid, token, acquiredAt: new Date().toISOString() };
    await handle.writeFile(JSON.stringify(record), "utf8");
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return true;
}

async function acquire(target: string, options: FileLockOptions): Promise<HeldLock> {
  const lockPath = lockFilePath(target);
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const token = randomUUID();
  const startedAt = Date.now();

  await mkdir(path.dirname(lockPath), { recursive: true });
  for (;;) {
    if (await tryCreate(lockPath, token)) return { lockPath, token };

    const reading = await readLock(lockPath).catch(() => null);
    if (reading && isStale(reading, staleMs)) {
      await breakStale(lockPath, reading, staleMs);
      continue;
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) throw new FileLockTimeoutError(target, reading?.record?.pid ?? null, waitedMs);
    await wait(retryMs + Math.floor(Math.random() * retryMs));
  }
}

async function release(held: HeldLock): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const current = await readLock(held.lockPath);
      if (current?.record?.token !== held.token) return;
      await unlink(held.lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      await wait(20 * (attempt + 1));
    }
  }
}

const inProcess = new Map<string, Promise<void>>();
const heldKeys = new AsyncLocalStorage<ReadonlySet<string>>();

export async function withFileLock<T>(target: string, work: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const key = path.resolve(target);
  const outer = heldKeys.getStore();
  if (outer?.has(key)) {
    throw new Error(
      `This process already holds the lock on ${path.basename(target)}; asking for it again from inside the locked work would wait forever.`
    );
  }
  const ahead = inProcess.get(key) ?? Promise.resolve();
  let finished!: () => void;
  const turn = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const tail = ahead.then(() => turn);
  inProcess.set(key, tail);

  await ahead;
  try {
    const held = await acquire(target, options);
    try {
      return await heldKeys.run(new Set([...(outer ?? []), key]), work);
    } finally {
      await release(held);
    }
  } finally {
    finished();
    if (inProcess.get(key) === tail) inProcess.delete(key);
  }
}
