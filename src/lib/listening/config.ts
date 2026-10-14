import { access, readFile } from "node:fs/promises";
import {
  DEFAULT_KEYWORD_GROUPS,
  defaultListeningConfig,
  keywordGroupSchema,
  listeningConfigSchema,
  migrateConfig,
  type KeywordGroup,
  type ListeningConfig
} from "@/lib/listening/model";
import { dataPath } from "@/lib/paths";
import { createJsonStore } from "@/lib/storage/json-store";

const store = createJsonStore("listening/config.json", listeningConfigSchema, defaultListeningConfig);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function legacyConfig(): Promise<ListeningConfig | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(dataPath("listening.json"), "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const legacy = raw as { groups?: unknown; sources?: { hn?: unknown; reddit?: unknown } };
  if (!Array.isArray(legacy.groups) && !legacy.sources) return null;

  const migrated = migrateConfig({ groups: Array.isArray(legacy.groups) ? legacy.groups : [], sources: { hn: legacy.sources?.hn, reddit: legacy.sources?.reddit }, autoScan: true }) as {
    groups: unknown[];
    sources: Record<string, unknown>;
  };
  const kept = migrated.groups.flatMap((group): KeywordGroup[] => {
    const parsed = keywordGroupSchema.safeParse(group);
    return parsed.success ? [parsed.data] : [];
  });
  const keptIds = new Set(kept.map((group) => group.id));
  const parsed = listeningConfigSchema.safeParse({
    ...migrated,
    groups: [...kept, ...DEFAULT_KEYWORD_GROUPS.filter((group) => !keptIds.has(group.id))]
  });
  return parsed.success ? parsed.data : null;
}

async function carryOverOldFile() {
  const file = store.filePath();
  if ((await exists(file)) || !(await legacyConfig())) return;
  await store.update(async (current) => ((await exists(file)) ? current : ((await legacyConfig()) ?? current)));
}

export async function readListeningConfig(): Promise<ListeningConfig> {
  await carryOverOldFile();
  return store.read();
}

export async function updateListeningConfig(mutate: (value: ListeningConfig) => ListeningConfig | Promise<ListeningConfig>) {
  await carryOverOldFile();
  return store.update(mutate);
}
