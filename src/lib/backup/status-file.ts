import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BackupStatus } from "@/lib/backup/status";
import { atomicWriteJson } from "@/lib/storage/atomic-json";

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
  await atomicWriteJson(path.join(dataDir, STATUS_FILE), status);
}
