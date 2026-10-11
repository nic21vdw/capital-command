import { defaultOutreachStore, outreachStoreSchema, type OutreachStore } from "@/lib/outreach/model";
import { createJsonStore } from "@/lib/storage/json-store";

/**
 * Outreach lives in its own file, data/outreach.json, so the main app-data
 * document and its schema stay untouched. See createJsonStore for the write
 * and concurrency rules.
 */
const store = createJsonStore("outreach.json", outreachStoreSchema, defaultOutreachStore);

export const readOutreachStore = (): Promise<OutreachStore> => store.read();
export const writeOutreachStore = (value: OutreachStore): Promise<void> => store.write(value);
export const updateOutreachStore = (mutate: (value: OutreachStore) => OutreachStore | Promise<OutreachStore>) => store.update(mutate);
