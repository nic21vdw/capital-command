import { defaultListeningStore, listeningStoreSchema, type ListeningStore } from "@/lib/listening/model";
import { createJsonStore } from "@/lib/storage/json-store";

/**
 * Listening lives in its own file, data/listening.json: keyword groups, source
 * switches, results and the last scan's report. See createJsonStore for the
 * write and concurrency rules.
 */
const store = createJsonStore("listening.json", listeningStoreSchema, defaultListeningStore);

export const readListeningStore = (): Promise<ListeningStore> => store.read();
export const writeListeningStore = (value: ListeningStore): Promise<void> => store.write(value);
export const updateListeningStore = (mutate: (value: ListeningStore) => ListeningStore | Promise<ListeningStore>) => store.update(mutate);
