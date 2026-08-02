import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { seedData } from "@/lib/mockData/seed";
import { appDataSchema } from "@/lib/storage/schemas";
import type { AppData } from "@/types/domain";

const dataFilePath = dataPath("capital-command.json");
let writeQueue = Promise.resolve();

async function ensureStore() {
  await mkdir(path.dirname(dataFilePath), { recursive: true });
}

export async function readAppData(): Promise<AppData> {
  await ensureStore();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await readFile(dataFilePath, "utf8");
      return appDataSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await writeAppData(seedData);
        return seedData;
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }
      await writeAppData(seedData);
      return seedData;
    }
  }

  return seedData;
}

async function commitTmpFile(tmpPath: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, dataFilePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retriable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!retriable || attempt >= 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export async function writeAppData(data: AppData) {
  const write = async () => {
    await ensureStore();
    const tmpPath = `${dataFilePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(appDataSchema.parse(data), null, 2), "utf8");
    try {
      await commitTmpFile(tmpPath);
    } catch (error) {
      await rm(tmpPath, { force: true });
      throw error;
    }
  };
  writeQueue = writeQueue.then(write, write);
  await writeQueue;
}

export async function resetAppData() {
  await writeAppData(seedData);
  return seedData;
}
