import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export async function removeQuietly(...targets: string[]): Promise<void> {
  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true }).catch(() => undefined)));
}

export async function removeByPrefix(dir: string, prefix: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await removeQuietly(...names.filter((name) => name.startsWith(prefix)).map((name) => path.join(dir, name)));
}
