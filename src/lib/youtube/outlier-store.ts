import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { defaultOutlierStore, outlierStoreSchema, type OutlierStore } from "@/lib/youtube/outliers";

/**
 * Persistence for the Outlier Radar, mirroring src/lib/storage/store.ts but in
 * its own file (data/youtube-outliers.json) so the main app-data store, its
 * schema, and the frozen publisher files stay untouched.
 */

const dataFilePath = dataPath("youtube-outliers.json");
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
    await atomicWriteJson(dataFilePath, outlierStoreSchema.parse(store));
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
