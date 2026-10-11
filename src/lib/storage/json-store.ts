import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { dataPath } from "@/lib/paths";

/**
 * A standalone JSON store under data/, the shape src/lib/youtube/outlier-store.ts
 * established: zod-parse on read, tmp-write + rename on write, and a
 * per-process queue that serialises each whole read-modify-write.
 *
 * Every read goes to disk, never a cached copy, so a CLI writing the same file
 * while the app is running reads fresh immediately before it writes and the
 * rename is atomic. A file that exists but fails to parse THROWS rather than
 * reading as the defaults — otherwise the next write would replace a real list
 * with an empty one.
 */
export function createJsonStore<S extends z.ZodTypeAny>(fileName: string, schema: S, defaults: z.infer<S>) {
  type Value = z.infer<S>;
  // Resolved per call, so the test setup's data-dir override always applies.
  const filePath = () => dataPath(fileName);
  let queue: Promise<unknown> = Promise.resolve();

  function serialised<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<Value> {
    let raw: string;
    try {
      raw = await readFile(filePath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(defaults);
      throw error;
    }
    try {
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(`${fileName} could not be read (${error instanceof Error ? error.message : String(error)}). Fix or move the file; it was left untouched.`);
    }
  }

  async function writeNow(value: Value): Promise<void> {
    const target = filePath();
    await mkdir(path.dirname(target), { recursive: true });
    const tmpPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(schema.parse(value), null, 2), "utf8");
    await rename(tmpPath, target);
  }

  return {
    filePath,
    read,
    write: (value: Value) => serialised(() => writeNow(value)),
    /** Read-modify-write, serialised so concurrent route handlers don't clobber each other. */
    update: (mutate: (value: Value) => Value | Promise<Value>): Promise<Value> =>
      serialised(async () => {
        const next = await mutate(await read());
        await writeNow(next);
        return next;
      })
  };
}
