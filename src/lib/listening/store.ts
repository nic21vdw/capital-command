import { readListeningConfig } from "@/lib/listening/config";
import { defaultListeningStore, listeningStoreSchema, type ListeningSnapshot, type ListeningStore } from "@/lib/listening/model";
import { createJsonStore } from "@/lib/storage/json-store";

/**
 * The hits live in data/listening.json: results, the last scan's report and the
 * YouTube quota ledger. The keywords and source switches live apart, in
 * data/listening/config.json (see config.ts). See createJsonStore for the write
 * and concurrency rules.
 */
const store = createJsonStore("listening.json", listeningStoreSchema, defaultListeningStore);

export const readListeningStore = (): Promise<ListeningStore> => store.read();
export const writeListeningStore = (value: ListeningStore): Promise<void> => store.write(value);
export const updateListeningStore = (mutate: (value: ListeningStore) => ListeningStore | Promise<ListeningStore>) => store.update(mutate);

export async function readListeningSnapshot(): Promise<ListeningSnapshot> {
  const [config, hits] = await Promise.all([readListeningConfig(), readListeningStore()]);
  return { ...config, ...hits };
}
