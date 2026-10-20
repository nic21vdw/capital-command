import { readFile, stat } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { atomicWriteFile, type AtomicWriteOptions } from "@/lib/storage/atomic-json";
import { DEFAULT_LOCK_STALE_MS, withFileLock } from "@/lib/storage/file-lock";

/**
 * Queue persistence. The queue itself is a single JSON document (matching the
 * repo's JSON-store convention — see README "Why this persistence choice").
 * Two backends:
 *
 *  - FileQueueStore: data/publish-queue.json, written through atomicWriteFile
 *    and locked across processes. Default for local use.
 *  - R2QueueStore: the same JSON document stored as an object in the R2/S3
 *    bucket. Required when the GitHub Actions cron is the runner, because the
 *    Actions machine cannot see the local data/ folder.
 */

export interface QueueStore {
  /** Returns the raw queue JSON, or null when no queue exists yet. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  describe(): string;
  /** A cheap fingerprint of the stored queue, when the backend has one. */
  version?(): Promise<string | null>;
  /** Runs `work` while no other process can save, when the backend can lock. */
  withLock?<T>(work: () => Promise<T>): Promise<T>;
  /** Same file lock, but its live holder cannot be evicted on an elapsed-time heuristic. */
  withStrictLock?<T>(work: () => Promise<T>): Promise<T>;
}

export const QUEUE_LOCK_TIMEOUT_MS = DEFAULT_LOCK_STALE_MS + 15_000;

const QUEUE_WRITE_OPTIONS: AtomicWriteOptions = { attempts: 40, maxBackoffMs: 500 };

export class FileQueueStore implements QueueStore {
  constructor(
    private readonly filePath = dataPath("publish-queue.json"),
    private readonly writeOptions: AtomicWriteOptions = {}
  ) {}

  describe(): string {
    return this.filePath;
  }

  async version(): Promise<string | null> {
    try {
      const info = await stat(this.filePath);
      return `${info.mtimeMs}:${info.size}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async load(): Promise<string | null> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(text: string): Promise<void> {
    await atomicWriteFile(this.filePath, text, { ...QUEUE_WRITE_OPTIONS, ...this.writeOptions });
  }

  withLock<T>(work: () => Promise<T>): Promise<T> {
    return withFileLock(this.filePath, work, { timeoutMs: QUEUE_LOCK_TIMEOUT_MS, reclaimLiveHolder: false });
  }

  withStrictLock<T>(work: () => Promise<T>): Promise<T> {
    return withFileLock(this.filePath, work, { timeoutMs: QUEUE_LOCK_TIMEOUT_MS, reclaimLiveHolder: false });
  }
}

/** Persists the queue JSON as an object in the media-hosting bucket. */
export class R2QueueStore implements QueueStore {
  constructor(
    private readonly host: {
      getObjectText(key: string): Promise<string | null>;
      putObjectText(key: string, text: string): Promise<void>;
      describe(): string;
    },
    private readonly key = "publisher/publish-queue.json"
  ) {}

  describe(): string {
    return `${this.host.describe()}/${this.key}`;
  }

  async load(): Promise<string | null> {
    return this.host.getObjectText(this.key);
  }

  async save(text: string): Promise<void> {
    await this.host.putObjectText(this.key, text);
  }
}
