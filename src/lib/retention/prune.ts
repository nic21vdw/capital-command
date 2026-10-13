import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { directorySizeBytes } from "@/lib/disk/size";

export const DEFAULT_SOURCE_DAYS = 30;
const SCRATCH_MAX_AGE_MS = 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const EXPORT_ID_PATTERN = /^export-([^-]+)-/;
const CLIP_SCRATCH_PATTERN = /^(seg-|caps-|export-)/;

export type PruneCategory = "longform-work" | "clip-work" | "source" | "tmp";

export type PruneItem = { path: string; bytes: number; category: PruneCategory; reason: string };
export type KeptSource = { path: string; reason: string };
export type FailedItem = PruneItem & { error: string };

export type PruneOptions = {
  dataDir: string;
  apply: boolean;
  now?: Date;
  sourceDays?: number;
  queueBackend?: string;
};

export type PruneReport = {
  apply: boolean;
  dataDir: string;
  sourceDays: number;
  candidates: PruneItem[];
  totalBytes: number;
  kept: KeptSource[];
  deleted: PruneItem[];
  failed: FailedItem[];
  freedBytes: number;
  notes: string[];
};

type JsonRecord = Record<string, unknown>;
type JsonFile = { state: "ok"; value: JsonRecord[] } | { state: "missing" } | { state: "unreadable" };

async function readJsonArray(file: string): Promise<JsonFile> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unreadable" };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? { state: "ok", value: parsed as JsonRecord[] } : { state: "unreadable" };
  } catch {
    return { state: "unreadable" };
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timeOf(value: unknown): number {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value: unknown): string {
  return text(value).toLowerCase();
}

function slashed(value: string): string {
  return value.replace(/\\/g, "/");
}

async function entries(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => [] as string[]);
}

async function mtimeMs(target: string): Promise<number | null> {
  try {
    const stats = await lstat(target);
    return stats.isSymbolicLink() ? null : stats.mtimeMs;
  } catch {
    return null;
  }
}

async function newestMtimeMs(dir: string): Promise<number> {
  let newest = (await mtimeMs(dir)) ?? 0;
  for (const name of await entries(dir)) newest = Math.max(newest, (await mtimeMs(path.join(dir, name))) ?? 0);
  return newest;
}

async function sizeOf(target: string): Promise<number> {
  return directorySizeBytes(target);
}

async function processingExportIds(dataDir: string): Promise<Set<string>> {
  const projects = await readJsonArray(path.join(dataDir, "longform", "projects.json"));
  const ids = new Set<string>();
  if (projects.state !== "ok") return ids;
  for (const project of projects.value) {
    const records = Array.isArray(project.exports) ? (project.exports as JsonRecord[]) : [];
    for (const record of records) if (record.status === "processing") ids.add(text(record.id));
  }
  return ids;
}

async function scratchCandidates(dataDir: string, now: number): Promise<PruneItem[]> {
  const cutoff = now - SCRATCH_MAX_AGE_MS;
  const inFlight = await processingExportIds(dataDir);
  const found: PruneItem[] = [];

  const consider = async (target: string, category: PruneCategory, reason: string) => {
    const modified = await mtimeMs(target);
    if (modified === null || modified > cutoff) return;
    found.push({ path: target, bytes: await sizeOf(target), category, reason });
  };

  const workRoot = path.join(dataDir, "longform", "work");
  for (const project of await entries(workRoot)) {
    for (const name of await entries(path.join(workRoot, project))) {
      const match = EXPORT_ID_PATTERN.exec(name);
      if (!match || inFlight.has(match[1])) continue;
      await consider(path.join(workRoot, project, name), "longform-work", "long-form export intermediate older than 24 hours");
    }
  }

  const uploadsRoot = path.join(dataDir, "clips", "uploads");
  for (const job of await entries(uploadsRoot)) {
    for (const name of await entries(path.join(uploadsRoot, job))) {
      if (!CLIP_SCRATCH_PATTERN.test(name)) continue;
      await consider(path.join(uploadsRoot, job, name), "clip-work", "clip render scratch file older than 24 hours");
    }
  }
  return found;
}

async function tmpCandidates(dataDir: string, now: number): Promise<PruneItem[]> {
  const cutoff = now - SCRATCH_MAX_AGE_MS;
  const protectedRoot = path.join(dataDir, "longform", "outputs");
  const found: PruneItem[] = [];
  const pending = [dataDir];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const full = path.join(dir, child.name);
      if (child.isDirectory()) {
        if (full !== protectedRoot) pending.push(full);
      } else if (child.isFile() && child.name.toLowerCase().endsWith(".tmp")) {
        const modified = await mtimeMs(full);
        if (modified !== null && modified <= cutoff) {
          found.push({ path: full, bytes: await sizeOf(full), category: "tmp", reason: "orphaned temp file older than 24 hours" });
        }
      }
    }
  }
  return found;
}

type SourceReferences = {
  queued: Set<string>;
  recentlyActive: Map<string, string>;
};

async function sourceReferences(
  dataDir: string,
  recentCutoff: number,
  queueBackend: string | undefined,
  notes: string[]
): Promise<SourceReferences | null> {
  if (queueBackend?.toLowerCase() === "r2") {
    notes.push(
      "Clip sources were left alone: the publish queue lives in the R2 bucket (PUBLISH_QUEUE_BACKEND=r2), so the local queue file cannot be trusted as a list of references."
    );
    return null;
  }
  const [queue, jobs, runs, projects] = await Promise.all([
    readJsonArray(path.join(dataDir, "publish-queue.json")),
    readJsonArray(path.join(dataDir, "clips", "jobs.json")),
    readJsonArray(path.join(dataDir, "pipeline", "runs.json")),
    readJsonArray(path.join(dataDir, "longform", "projects.json"))
  ]);
  if (queue.state !== "ok") {
    notes.push(
      `Clip sources were left alone: the publish queue (publish-queue.json) ${queue.state === "missing" ? "was not found" : "could not be read"}, so it cannot be checked for references.`
    );
    return null;
  }
  for (const [label, file] of [
    ["clip jobs (clips/jobs.json)", jobs],
    ["pipeline runs (pipeline/runs.json)", runs],
    ["long-form projects (longform/projects.json)", projects]
  ] as const) {
    if (file.state === "unreadable") {
      notes.push(`Clip sources were left alone: ${label} could not be read, so it cannot be checked for references.`);
      return null;
    }
  }
  const jobList = jobs.state === "ok" ? jobs.value : [];
  const runList = runs.state === "ok" ? runs.value : [];
  const projectList = projects.state === "ok" ? projects.value : [];

  const sourceOfJob = new Map(jobList.map((job) => [key(job.id), key(job.sourceId)]));
  const sourceOfRun = new Map(runList.map((run) => [key(run.id), key(run.sourceId)]));

  const queued = new Set<string>();
  const addSource = (id: string | undefined) => {
    if (id) queued.add(id);
  };
  for (const item of queue.value) {
    const paths = [item.clipPath, item.sourceClipPath, ...(Array.isArray(item.imagePaths) ? item.imagePaths : [])];
    for (const candidate of paths) {
      const normal = slashed(text(candidate));
      addSource(/clips\/sources\/([^/]+)/i.exec(normal)?.[1]?.toLowerCase());
      const jobFromPath = /clips\/outputs\/([^/]+)/i.exec(normal)?.[1]?.toLowerCase();
      if (jobFromPath) addSource(sourceOfJob.get(jobFromPath));
    }
    addSource(sourceOfJob.get(key(item.jobId)));
    addSource(sourceOfRun.get(key(item.runId)));
  }

  const recentlyActive = new Map<string, string>();
  const note = (sourceId: string, reason: string) => {
    if (sourceId && !recentlyActive.has(sourceId)) recentlyActive.set(sourceId, reason);
  };
  for (const job of jobList) {
    const touched = Math.max(timeOf(job.finishedAt), timeOf(job.createdAt));
    if (touched > recentCutoff) note(key(job.sourceId), "a clip job on it is unfinished or finished recently");
  }
  for (const run of runList) {
    if (Math.max(timeOf(run.updatedAt), timeOf(run.createdAt)) > recentCutoff) {
      note(key(run.sourceId), "a pipeline run on it was active recently");
    }
  }
  for (const project of projectList) {
    if (timeOf(project.updatedAt) > recentCutoff) note(key(project.sourceId), "a long-form project on it was active recently");
  }
  return { queued, recentlyActive };
}

async function sourceCandidates(
  dataDir: string,
  now: number,
  sourceDays: number,
  queueBackend: string | undefined,
  notes: string[]
): Promise<{ candidates: PruneItem[]; kept: KeptSource[] }> {
  const sourcesRoot = path.join(dataDir, "clips", "sources");
  const ids = await entries(sourcesRoot);
  if (ids.length === 0) return { candidates: [], kept: [] };

  const cutoff = now - sourceDays * DAY_MS;
  const references = await sourceReferences(dataDir, cutoff, queueBackend, notes);
  if (!references) return { candidates: [], kept: [] };

  const candidates: PruneItem[] = [];
  const kept: KeptSource[] = [];
  for (const id of ids) {
    const dir = path.join(sourcesRoot, id);
    const stats = await lstat(dir).catch(() => null);
    if (!stats || !stats.isDirectory()) continue;
    if (references.queued.has(id.toLowerCase())) {
      kept.push({ path: dir, reason: "referenced by the publish queue" });
      continue;
    }
    const activity = references.recentlyActive.get(id.toLowerCase());
    if (activity) {
      kept.push({ path: dir, reason: activity });
      continue;
    }
    if ((await newestMtimeMs(dir)) > cutoff) {
      kept.push({ path: dir, reason: `newer than ${sourceDays} days` });
      continue;
    }
    candidates.push({
      path: dir,
      bytes: await sizeOf(dir),
      category: "source",
      reason: `source older than ${sourceDays} days, not referenced by the publish queue or recent work`
    });
  }
  return { candidates, kept };
}

function withoutNested(items: PruneItem[]): PruneItem[] {
  const dirs = items.map((item) => item.path + path.sep);
  return items.filter((item) => !dirs.some((dir) => item.path.startsWith(dir)));
}

function insideData(dataDir: string, target: string): boolean {
  const relative = path.relative(dataDir, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function pruneData(options: PruneOptions): Promise<PruneReport> {
  const dataDir = path.resolve(options.dataDir);
  const now = (options.now ?? new Date()).getTime();
  const sourceDays = options.sourceDays ?? DEFAULT_SOURCE_DAYS;
  const notes: string[] = [];

  const scratch = await scratchCandidates(dataDir, now);
  const sources = await sourceCandidates(dataDir, now, sourceDays, options.queueBackend, notes);
  const tmp = await tmpCandidates(dataDir, now);

  const protectedOutputs = path.join(dataDir, "longform", "outputs") + path.sep;
  const candidates = withoutNested([...scratch, ...sources.candidates, ...tmp])
    .filter((item) => insideData(dataDir, item.path) && !(item.path + path.sep).startsWith(protectedOutputs))
    .sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = candidates.reduce((sum, item) => sum + item.bytes, 0);

  const deleted: PruneItem[] = [];
  const failed: FailedItem[] = [];
  if (options.apply) {
    for (const item of candidates) {
      try {
        await rm(item.path, { recursive: true, force: true });
        deleted.push(item);
      } catch (error) {
        failed.push({ ...item, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return {
    apply: options.apply,
    dataDir,
    sourceDays,
    candidates,
    totalBytes,
    kept: sources.kept,
    deleted,
    failed,
    freedBytes: deleted.reduce((sum, item) => sum + item.bytes, 0),
    notes
  };
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function relativeLabel(dataDir: string, target: string): string {
  return path.relative(dataDir, target).replace(/\\/g, "/");
}

export function formatPruneReport(report: PruneReport): string {
  const lines: string[] = [];
  lines.push(`Data prune (${report.apply ? "APPLIED" : "dry run"}) on ${report.dataDir}`);
  lines.push("");
  const count = report.candidates.length;
  lines.push(
    report.apply
      ? `Deleted ${report.deleted.length} of ${count} items, ${formatSize(report.freedBytes)} freed.`
      : `Would delete ${count} item${count === 1 ? "" : "s"}, ${formatSize(report.totalBytes)} in total.`
  );
  for (const item of report.candidates) {
    lines.push(`  ${formatSize(item.bytes).padStart(10)}  ${relativeLabel(report.dataDir, item.path)}  (${item.reason})`);
  }
  if (report.failed.length > 0) {
    lines.push("");
    lines.push(`Could not delete ${report.failed.length}:`);
    for (const item of report.failed) lines.push(`  ${relativeLabel(report.dataDir, item.path)}: ${item.error}`);
  }
  if (report.kept.length > 0) {
    lines.push("");
    lines.push(`Clip sources kept (${report.kept.length}):`);
    for (const item of report.kept) lines.push(`  ${relativeLabel(report.dataDir, item.path)}  (${item.reason})`);
  }
  for (const note of report.notes) {
    lines.push("");
    lines.push(note);
  }
  if (!report.apply) {
    lines.push("");
    lines.push("Dry run only: nothing was deleted. Run again with --apply to delete the items above.");
  }
  return lines.join("\n");
}

export type PruneArgs = { apply: boolean; sourceDays: number; dataDir?: string };

export function parsePruneArgs(argv: string[]): PruneArgs {
  const args: PruneArgs = { apply: false, sourceDays: DEFAULT_SOURCE_DAYS };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    const value = () => inline ?? argv[++index];
    if (flag === "--apply") {
      args.apply = true;
    } else if (flag === "--source-days") {
      const days = Number(value());
      if (!Number.isFinite(days) || days <= 0) throw new Error("--source-days needs a number of days greater than 0.");
      args.sourceDays = days;
    } else if (flag === "--data") {
      const dir = value();
      if (!dir) throw new Error("--data needs a folder.");
      args.dataDir = dir;
    } else {
      throw new Error(`Unknown option ${argv[index]}. Use --apply, --source-days <n> or --data <folder>.`);
    }
  }
  return args;
}
