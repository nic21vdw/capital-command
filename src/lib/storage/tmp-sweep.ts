import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { isLockHeld } from "@/lib/storage/file-lock";

export interface SweepOptions {
  olderThanMs?: number;
  maxDepth?: number;
  now?: number;
}

export interface SweepResult {
  removed: string[];
  heldByLock: string[];
  failed: string[];
}

const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
const TEMPORARY_SUFFIX = /(\.\d+(\.[^./\\]+)?)?\.tmp$/;

export function targetOfTemporaryFile(file: string): string {
  return file.replace(TEMPORARY_SUFFIX, "");
}

async function* walk(folder: string, depth: number, maxDepth: number): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isFile() && entry.name.endsWith(".tmp")) yield full;
    else if (entry.isDirectory() && depth < maxDepth && !SKIPPED_FOLDERS.has(entry.name)) yield* walk(full, depth + 1, maxDepth);
  }
}

export async function sweepStaleTmpFiles(root: string = dataRoot(), options: SweepOptions = {}): Promise<SweepResult> {
  const olderThanMs = options.olderThanMs ?? 3_600_000;
  const maxDepth = options.maxDepth ?? 3;
  const now = options.now ?? Date.now();
  const result: SweepResult = { removed: [], heldByLock: [], failed: [] };

  for await (const file of walk(root, 0, maxDepth)) {
    try {
      const info = await stat(file);
      if (now - info.mtimeMs < olderThanMs) continue;
      if (await isLockHeld(targetOfTemporaryFile(file))) {
        result.heldByLock.push(file);
        continue;
      }
      await unlink(file);
      result.removed.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.failed.push(file);
    }
  }
  return result;
}
