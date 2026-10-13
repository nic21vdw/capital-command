import { directorySizeBytes } from "@/lib/disk/size";
import { dataVolumeSpace, renderMinFreeBytes, type DiskSpace } from "@/lib/disk/space";
import { dataRoot } from "@/lib/paths";

export const DATA_SIZE_TTL_MS = 10 * 60_000;

export type DataSizeReading = { bytes: number | null; measuredAt: number | null; computing: boolean };

export type DataSizeCache = {
  read(): DataSizeReading;
  idle(): Promise<void>;
};

export function createDataSizeCache(options: {
  measure: () => Promise<number>;
  ttlMs?: number;
  now?: () => number;
}): DataSizeCache {
  const ttlMs = options.ttlMs ?? DATA_SIZE_TTL_MS;
  const now = options.now ?? Date.now;
  let bytes: number | null = null;
  let measuredAt: number | null = null;
  let attemptedAt: number | null = null;
  let inflight: Promise<void> | null = null;

  const start = () => {
    attemptedAt = now();
    inflight = options
      .measure()
      .then((size) => {
        bytes = size;
        measuredAt = now();
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = null;
      });
  };

  return {
    read() {
      if (!inflight && (attemptedAt === null || now() - attemptedAt > ttlMs)) start();
      return { bytes, measuredAt, computing: inflight !== null };
    },
    idle: async () => {
      await inflight;
    }
  };
}

type SharedGlobal = typeof globalThis & { __dataSizeCache?: DataSizeCache };

function sharedDataSizeCache(): DataSizeCache {
  const shared = globalThis as SharedGlobal;
  return (shared.__dataSizeCache ??= createDataSizeCache({ measure: () => directorySizeBytes(dataRoot()) }));
}

export type DiskUsage = {
  freeBytes: number;
  totalBytes: number;
  minFreeBytes: number;
  low: boolean;
  dataBytes: number | null;
  dataComputing: boolean;
};

export async function readDiskUsage(
  options: {
    space?: () => Promise<DiskSpace>;
    minBytes?: number;
    dataSize?: Pick<DataSizeCache, "read">;
  } = {}
): Promise<DiskUsage> {
  const { freeBytes, totalBytes } = await (options.space ?? dataVolumeSpace)();
  const minFreeBytes = options.minBytes ?? renderMinFreeBytes();
  const data = (options.dataSize ?? sharedDataSizeCache()).read();
  return {
    freeBytes,
    totalBytes,
    minFreeBytes,
    low: freeBytes < minFreeBytes,
    dataBytes: data.bytes,
    dataComputing: data.computing
  };
}
