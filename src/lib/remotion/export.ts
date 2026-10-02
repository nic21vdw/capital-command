import os from "node:os";

export function remotionConcurrency(cpus = os.cpus()?.length || 2): number {
  return Math.max(1, Math.min(8, cpus - 1));
}

export const REMOTION_EXPORT = {
  codec: "h264" as const,
  // Scenes authored at 1080p are rasterized directly at 4K, including text.
  scale: 2,
  crf: 17,
  imageFormat: "png" as const
} as const;
