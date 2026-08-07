import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

/** A read that could not be trusted. The file is left exactly as it was. */
export class AppDataUnreadableError extends Error {
  constructor(
    message: string,
    readonly copyPath: string | null
  ) {
    super(message);
    this.name = "AppDataUnreadableError";
  }
}

/**
 * The document, or an error — never a fresh start.
 *
 * A file that exists but will not parse used to be answered with `seedData`,
 * AND WRITTEN BACK: one unrecognised field turned every carousel, holding and
 * content item into demo data, silently, with no copy kept. A file that is
 * there and unreadable is a reason to stop, not to replace — the pipeline store
 * has always worked this way (`readRunsFile` leaves itself unloaded). Only a
 * file that genuinely does not exist gets the seed.
 */
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
        // A read can land mid-write; the retry is for that, not for damage.
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }
      const copyPath = await keepCorruptCopy();
      throw new AppDataUnreadableError(
        `The app data file could not be read${copyPath ? ` — a copy is at ${path.basename(copyPath)}` : ""}. Nothing has been changed.`,
        copyPath
      );
    }
  }

  throw new AppDataUnreadableError("The app data file could not be read. Nothing has been changed.", null);
}

/**
 * Best effort: ONE copy to look at later. Every screen and the sidebar's poll
 * read app data, so copying per failed read wrote thousands of copies of a
 * multi-megabyte file in a day. Failing to copy must not hide the read failure.
 */
async function keepCorruptCopy(): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const copyPath = `${dataFilePath}.unreadable-${stamp}`;
  try {
    const existing = (await readdir(path.dirname(dataFilePath))).filter((name) =>
      name.startsWith(`${path.basename(dataFilePath)}.unreadable-`)
    );
    if (existing.length > 0) return path.join(path.dirname(dataFilePath), existing[existing.length - 1]);
    await copyFile(dataFilePath, copyPath);
    return copyPath;
  } catch {
    return null;
  }
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
