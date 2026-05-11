import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedData } from "@/lib/mockData/seed";
import { appDataSchema } from "@/lib/storage/schemas";
import type { AppData } from "@/types/domain";

const dataFilePath = path.join(process.cwd(), "data", "capital-command.json");

async function ensureStore() {
  await mkdir(path.dirname(dataFilePath), { recursive: true });
}

export async function readAppData(): Promise<AppData> {
  await ensureStore();

  try {
    const raw = await readFile(dataFilePath, "utf8");
    return appDataSchema.parse(JSON.parse(raw));
  } catch {
    await writeAppData(seedData);
    return seedData;
  }
}

export async function writeAppData(data: AppData) {
  await ensureStore();
  await writeFile(dataFilePath, JSON.stringify(appDataSchema.parse(data), null, 2), "utf8");
}

export async function resetAppData() {
  await writeAppData(seedData);
  return seedData;
}
