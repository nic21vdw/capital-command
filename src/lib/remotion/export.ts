import os from "node:os";

export function remotionConcurrency(cpus = os.cpus()?.length || 2): number {
  return Math.max(1, Math.min(8, cpus - 1));
}

export const REMOTION_EXPORT = {
  codec: "h264" as const,
  scale: 1,
  crf: 17,
  imageFormat: "jpeg" as const,
  jpegQuality: 92
} as const;
