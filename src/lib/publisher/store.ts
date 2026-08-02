import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

/**
 * Queue persistence. The queue itself is a single JSON document (matching the
 * repo's JSON-store convention — see README "Why this persistence choice").
 * Two backends:
 *
 *  - FileQueueStore: data/publish-queue.json with the same atomic
 *    write-then-rename pattern as the clip jobs store. Default for local use.
 *  - R2QueueStore: the same JSON document stored as an object in the R2/S3
 *    bucket. Required when the GitHub Actions cron is the runner, because the
 *    Actions machine cannot see the local data/ folder.
 */

export interface QueueStore {
  /** Returns the raw queue JSON, or null when no queue exists yet. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  describe(): string;
}

export class FileQueueStore implements QueueStore {
  constructor(private readonly filePath = dataPath("publish-queue.json")) {}

  describe(): string {
    return this.filePath;
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
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, text, "utf8");
    try {
      await rename(tmpPath, this.filePath);
    } catch (error) {
      // Windows can refuse the swap while another process reads the file.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
        await writeFile(this.filePath, text, "utf8");
        await unlink(tmpPath).catch(() => undefined);
        return;
      }
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
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
