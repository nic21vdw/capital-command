import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

const STAT_BATCH = 64;

export async function directorySizeBytes(root: string): Promise<number> {
  let rootStats;
  try {
    rootStats = await lstat(root);
  } catch {
    return 0;
  }
  if (rootStats.isSymbolicLink()) return 0;
  if (!rootStats.isDirectory()) return rootStats.size;

  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
    }
    for (let index = 0; index < files.length; index += STAT_BATCH) {
      const sizes = await Promise.all(
        files.slice(index, index + STAT_BATCH).map((file) =>
          lstat(file).then(
            (stats) => stats.size,
            () => 0
          )
        )
      );
      for (const size of sizes) total += size;
    }
  }
  return total;
}
