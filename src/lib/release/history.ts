import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "@/lib/paths";
import type { UpdateTiming } from "./timings";

const duration = z.number().int().nonnegative();
const record = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  durationMs: duration.nullable(),
  status: z.enum(["running", "completed", "failed", "unchanged", "prepared"]),
  steps: z.array(z.object({
    label: z.string().min(1).max(200),
    durationMs: duration.nullable(),
    status: z.enum(["running", "completed", "failed"]),
    details: z.array(z.object({ label: z.string().min(1).max(80), durationMs: duration }).strict()).max(10)
  }).strict()).max(30)
}).strict();

export async function readUpdateHistory(): Promise<UpdateTiming[]> {
  let files: string[];
  try {
    files = await readdir(dataPath("update-history"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const results = await Promise.all(files.filter((file) => /^[a-f0-9]{32}\.json$/.test(file)).map(async (file) => {
    try {
      const parsed = record.safeParse(JSON.parse(await readFile(dataPath("update-history", file), "utf8")));
      return parsed.success && `${parsed.data.id}.json` === file ? parsed.data : null;
    } catch { return null; }
  }));
  return results.filter((item): item is UpdateTiming => item !== null)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)).slice(0, 20);
}
