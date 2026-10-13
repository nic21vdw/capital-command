import { statfs } from "node:fs/promises";
import path from "node:path";
import { formatGb } from "@/lib/disk/format";
import { dataRoot } from "@/lib/paths";

export const DEFAULT_RENDER_MIN_FREE_GB = 40;

const GB = 1024 ** 3;

export type DiskSpace = { freeBytes: number; totalBytes: number };

export class DiskSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiskSpaceError";
  }
}

export function renderMinFreeBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RENDER_MIN_FREE_GB?.trim();
  const gb = raw ? Number(raw) : Number.NaN;
  return Math.round((Number.isFinite(gb) && gb >= 0 ? gb : DEFAULT_RENDER_MIN_FREE_GB) * GB);
}

export async function dataVolumeSpace(dir: string = dataRoot()): Promise<DiskSpace> {
  let target = path.resolve(dir);
  for (;;) {
    try {
      const stats = await statfs(target);
      return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
    } catch (error) {
      const parent = path.dirname(target);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === target) throw error;
      target = parent;
    }
  }
}

export function lowDiskMessage(freeBytes: number, minBytes: number): string {
  return (
    `Not enough free disk space to render: ${formatGb(freeBytes)} free on the data drive, ${formatGb(minBytes)} needed. ` +
    "Delete old work files (npm run data:prune lists what can go) or free up space, then try again."
  );
}

export function diskFullMessage(): string {
  return (
    "The disk filled up while rendering, so the render was stopped and its temporary files were removed. " +
    "Free up space on the data drive (npm run data:prune lists what can go) and try again."
  );
}

export async function assertEnoughDiskSpace(
  options: { space?: () => Promise<DiskSpace>; minBytes?: number } = {}
): Promise<void> {
  const minBytes = options.minBytes ?? renderMinFreeBytes();
  if (minBytes <= 0) return;
  let space: DiskSpace;
  try {
    space = await (options.space ?? dataVolumeSpace)();
  } catch {
    return;
  }
  if (space.freeBytes < minBytes) throw new DiskSpaceError(lowDiskMessage(space.freeBytes, minBytes));
}

export function isNoSpaceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    (error as NodeJS.ErrnoException).code === "ENOSPC" || /ENOSPC|no space left on device/i.test(error.message)
  );
}

export function renderFailureMessage(error: unknown): string {
  if (error instanceof DiskSpaceError) return error.message;
  if (isNoSpaceError(error)) return diskFullMessage();
  return error instanceof Error ? error.message : String(error);
}
