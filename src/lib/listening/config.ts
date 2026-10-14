import { defaultListeningConfig, listeningConfigSchema, type ListeningConfig } from "@/lib/listening/model";
import { createJsonStore } from "@/lib/storage/json-store";

const store = createJsonStore("listening/config.json", listeningConfigSchema, defaultListeningConfig);

export const readListeningConfig = (): Promise<ListeningConfig> => store.read();
export const updateListeningConfig = (mutate: (value: ListeningConfig) => ListeningConfig | Promise<ListeningConfig>) => store.update(mutate);
