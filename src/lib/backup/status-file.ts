import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BackupStatus } from "@/lib/backup/status";

export const STATUS_FILE = "backup-status.json";

export async function readBackupStatus(dataDir: string): Promise<BackupStatus | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dataDir, STATUS_FILE), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const status = parsed as Partial<BackupStatus>;
    if (typeof status.at !== "string" || typeof status.ok !== "boolean") return null;
    return status as BackupStatus;
  } catch {
    return null;
  }
}

export async function writeBackupStatus(dataDir: string, status: BackupStatus): Promise<void> {
  const target = path.join(dataDir, STATUS_FILE);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dataDir, { recursive: true });
  try {
    await writeFile(tmp, JSON.stringify(status, null, 2), "utf8");
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
