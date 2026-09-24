import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { StoryOverrides } from "@/lib/story/types";

export const STORY_ROOT_PARTS = ["longform-story"] as const;

export type StoryStage = "analyze" | "score" | "story" | "edit" | "copy" | "render" | "verify" | "frames" | "package" | "upload";

export type StoryStatus = {
  id: string;
  title: string;
  sourceUrl?: string;
  sourcePath: string;
  durationSec: number;
  width?: number;
  height?: number;
  stage: StoryStage | "idle" | "done" | "error";
  busy: boolean;
  error?: string;
  log: Array<{ at: string; message: string }>;
  updatedAt: string;
};

export function storyRoot(): string {
  return dataPath(...STORY_ROOT_PARTS);
}

export function projectDir(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid story project id: ${id}`);
  return path.join(storyRoot(), id);
}

export function projectFile(id: string, ...parts: string[]): string {
  const base = projectDir(id);
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base))) throw new Error("Path escapes the story project.");
  return resolved;
}

export function packageFile(id: string, ...parts: string[]): string {
  return projectFile(id, "package", ...parts);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export const EMPTY_OVERRIDES: StoryOverrides = { disabledUnitIds: [], takeChoices: {}, zoom: {} };

export async function readOverrides(id: string): Promise<StoryOverrides> {
  const stored = await readJson<Partial<StoryOverrides>>(projectFile(id, "overrides.json"));
  return {
    disabledUnitIds: stored?.disabledUnitIds ?? [],
    hookUnitIds: stored?.hookUnitIds,
    takeChoices: stored?.takeChoices ?? {},
    zoom: stored?.zoom ?? {}
  };
}

export async function writeOverrides(id: string, overrides: StoryOverrides): Promise<void> {
  await writeJson(projectFile(id, "overrides.json"), overrides);
}

export async function readStatus(id: string): Promise<StoryStatus | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = await readJson<StoryStatus>(projectFile(id, "status.json"));
    if (status) return status;
    if (!(await exists(projectFile(id, "status.json")))) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

const statusQueue = new Map<string, Promise<unknown>>();

export function updateStatus(id: string, patch: Partial<StoryStatus>, message?: string): Promise<StoryStatus> {
  const run = async (): Promise<StoryStatus> => {
    const current = (await readStatus(id)) ?? {
      id,
      title: id,
      sourcePath: projectFile(id, "source.mp4"),
      durationSec: 0,
      stage: "idle" as const,
      busy: false,
      log: [],
      updatedAt: new Date().toISOString()
    };
    const next: StoryStatus = {
      ...current,
      ...patch,
      log: message ? [...current.log, { at: new Date().toISOString(), message }].slice(-200) : current.log,
      updatedAt: new Date().toISOString()
    };
    await writeJson(projectFile(id, "status.json"), next);
    return next;
  };
  const queued = (statusQueue.get(id) ?? Promise.resolve()).then(run, run);
  statusQueue.set(id, queued.catch(() => undefined));
  return queued;
}

export async function listProjects(): Promise<StoryStatus[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(storyRoot());
  } catch {
    return [];
  }
  const statuses = await Promise.all(entries.map((entry) => readStatus(entry).catch(() => null)));
  return statuses.filter((status): status is StoryStatus => Boolean(status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
