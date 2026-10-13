const GB = 1024 ** 3;

export function formatGb(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}

export type DiskLineInput = {
  freeBytes: number;
  totalBytes: number;
  minFreeBytes: number;
  low: boolean;
  dataBytes: number | null;
  dataComputing: boolean;
};

export function describeDiskUsage(usage: DiskLineInput): { summary: string; warning: string | null } {
  const data = usage.dataBytes !== null ? formatGb(usage.dataBytes) : usage.dataComputing ? "measuring" : "unknown";
  return {
    summary: `${formatGb(usage.freeBytes)} free of ${formatGb(usage.totalBytes)} · data folder ${data}`,
    warning: usage.low
      ? `Under the ${formatGb(usage.minFreeBytes)} render minimum, so new renders are refused until space is freed.`
      : null
  };
}
