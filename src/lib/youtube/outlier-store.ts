import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultOutlierStore, outlierStoreSchema, type OutlierStore } from "@/lib/youtube/outliers";

/**
 * Persistence for the Outlier Radar, mirroring src/lib/storage/store.ts but in
 * its own file (data/youtube-outliers.json) so the main app-data store, its
 * schema, and the frozen publisher files stay untouched.
 */

const dataFilePath = path.join(process.cwd(), "data", "youtube-outliers.json");
let writeQueue = Promise.resolve();

export async function readOutlierStore(): Promise<OutlierStore> {
  try {
    const raw = await readFile(dataFilePath, "utf8");
    return outlierStoreSchema.parse(JSON.parse(raw));
  } catch {
    // Missing file = first use; a corrupt file falls back to defaults but is
    // only overwritten when the next mutation writes.
    return structuredClone(defaultOutlierStore);
  }
}

export async function writeOutlierStore(store: OutlierStore): Promise<void> {
  const write = async () => {
    await mkdir(path.dirname(dataFilePath), { recursive: true });
    const tmpPath = `${dataFilePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(outlierStoreSchema.parse(store), null, 2), "utf8");
    await rename(tmpPath, dataFilePath);
  };
  writeQueue = writeQueue.then(write, write);
  await writeQueue;
}

/** Read-modify-write helper so concurrent route handlers don't clobber each other. */
export async function updateOutlierStore(
  mutate: (store: OutlierStore) => OutlierStore | Promise<OutlierStore>
): Promise<OutlierStore> {
  const next = await mutate(await readOutlierStore());
  await writeOutlierStore(next);
  return next;
}
