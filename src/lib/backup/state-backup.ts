import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBackupStatus, writeBackupStatus } from "@/lib/backup/status-file";
import type { BackupStatus } from "@/lib/backup/status";
import { openZip, writeZip, type ZipEntry } from "@/lib/backup/zip";

export const BACKUP_FOLDER_NAME = "CoLateral Marketing Backups";
export const KEEP_BACKUPS = 30;
export const ARCHIVE_PATTERN = /^capital-command-state-\d{8}-\d{4}\.zip$/;
export const DEFAULT_LIMITS = { maxFileBytes: 50 * 1024 * 1024, maxLogBytes: 5 * 1024 * 1024 };

const CORE_CEILING_BYTES = 500 * 1024 * 1024;

const CORE_STATE = new Set([
  "capital-command.json",
  "publish-queue.json",
  "threads-queue.json",
  "threads-state.json",
  "social-accounts.json",
  "channel-ingest.json",
  "clips/jobs.json",
  "longform/projects.json",
  "longform/music/jobs.json",
  "agents/runs.json",
  "automations/control.json"
]);

const STATE_EXTENSIONS = new Set([".json", ".jsonl"]);
const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg",
  ".png", ".jpg", ".jpeg", ".webp", ".gif"
]);
const SECRET_NAME = /(^|[^a-z])(tokens?|secrets?|credentials?|oauth|passwords?|api-?keys?)([^a-z]|$)/i;
const SECRET_EXTENSIONS = new Set([".json", ".jsonl", ".txt", ".env", ".key", ".pem"]);
const LOG_FILE = /\.log(\.\d+|\.old)?$/i;
const TOOLING_DIRECTORIES = ["clips/bin"];
const STATUS_RELATIVE = "backup-status.json";

const KNOWN_SECRETS: Record<string, string> = {
  "publisher-tokens.json": "Reconnect YouTube, TikTok, Instagram and Facebook in Settings; the saved sign-ins for those platforms were not backed up.",
  "credentials.json": "Re-enter the platform keys and secrets you saved in Settings; they were not backed up.",
  "voice/xai-oauth.json": "Sign in to Grok Voice again from the Agents page; the saved sign-in was not backed up."
};

export type BackupLimits = { maxFileBytes: number; maxLogBytes: number };

export type ManifestSecret = { path: string; present: boolean; reconnect: string };

export type ManifestSkipped = { path: string; reason: string; bytes?: number };

export type BackupManifest = {
  format: 1;
  app: "capital-command";
  createdAt: string;
  host: string;
  dataDir: string;
  fileCount: number;
  totalBytes: number;
  files: { path: string; bytes: number }[];
  excludedSecrets: ManifestSecret[];
  skipped: ManifestSkipped[];
  skippedCounts: { media: number; temporary: number; other: number };
  limits: BackupLimits;
};

type Candidate = { relative: string; absolute: string; bytes: number; modified: Date; core: boolean };

type Collected = {
  included: Candidate[];
  secrets: ManifestSecret[];
  skipped: ManifestSkipped[];
  skippedCounts: BackupManifest["skippedCounts"];
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function secretReason(relative: string): string {
  return (
    (Object.hasOwn(KNOWN_SECRETS, relative.toLowerCase()) ? KNOWN_SECRETS[relative.toLowerCase()] : undefined) ??
    `${relative} holds a sign-in or key and is never backed up; reconnect whatever used it.`
  );
}

async function walk(dir: string, prefix: string, found: { relative: string; absolute: string }[], tooling: string[]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (TOOLING_DIRECTORIES.includes(relative.toLowerCase())) tooling.push(relative);
      else await walk(path.join(dir, entry.name), relative, found, tooling);
    } else if (entry.isFile()) {
      found.push({ relative, absolute: path.join(dir, entry.name) });
    }
  }
}

export async function collectStateFiles(
  dataDir: string,
  rootDir: string,
  limits: BackupLimits = DEFAULT_LIMITS
): Promise<Collected> {
  const found: { relative: string; absolute: string }[] = [];
  const tooling: string[] = [];
  await walk(dataDir, "", found, tooling);
  found.sort((a, b) => a.relative.localeCompare(b.relative));

  const included: Candidate[] = [];
  const secrets: ManifestSecret[] = [];
  const skipped: ManifestSkipped[] = tooling.map((relative) => ({
    path: `${relative}/`,
    reason: "downloaded tooling (speech models, yt-dlp); re-downloaded on demand"
  }));
  const skippedCounts = { media: 0, temporary: 0, other: 0 };

  for (const file of found) {
    const extension = path.extname(file.relative).toLowerCase();
    const base = path.basename(file.relative);
    const lowered = file.relative.toLowerCase();

    if (extension === ".tmp") {
      skippedCounts.temporary += 1;
      continue;
    }
    if (SECRET_EXTENSIONS.has(extension) && (SECRET_NAME.test(base) || Object.hasOwn(KNOWN_SECRETS, lowered))) {
      secrets.push({ path: file.relative, present: true, reconnect: secretReason(file.relative) });
      continue;
    }
    if (MEDIA_EXTENSIONS.has(extension)) {
      skippedCounts.media += 1;
      continue;
    }
    if (lowered === STATUS_RELATIVE) continue;

    const isLog = LOG_FILE.test(base);
    if (!STATE_EXTENSIONS.has(extension) && !isLog) {
      skippedCounts.other += 1;
      continue;
    }

    let info;
    try {
      info = await stat(file.absolute);
    } catch {
      continue;
    }
    const core = CORE_STATE.has(lowered);

    if (isLog && info.size > limits.maxLogBytes) {
      skipped.push({ path: file.relative, reason: `log over ${formatSize(limits.maxLogBytes)}`, bytes: info.size });
      continue;
    }
    const cap = core ? Math.max(limits.maxFileBytes, CORE_CEILING_BYTES) : limits.maxFileBytes;
    if (info.size > cap) {
      skipped.push({ path: file.relative, reason: `over ${formatSize(limits.maxFileBytes)}`, bytes: info.size });
      continue;
    }
    included.push({ relative: file.relative, absolute: file.absolute, bytes: info.size, modified: info.mtime, core });
  }

  const rootNames = await readdir(rootDir).catch(() => [] as string[]);
  const envFiles = rootNames
    .filter((name) => /^\.env(\..+)?$/i.test(name) && name.toLowerCase() !== ".env.example")
    .sort();
  if (!envFiles.includes(".env")) envFiles.unshift(".env");
  for (const name of envFiles) {
    const present = rootNames.includes(name);
    secrets.push({
      path: name,
      present,
      reconnect:
        name === ".env"
          ? "Put your .env back (API keys, platform client ids and secrets); it is never backed up."
          : `${name} is a copy of your environment file and holds keys; it is never backed up.`
    });
  }

  secrets.sort((a, b) => a.path.localeCompare(b.path));
  return { included, secrets, skipped, skippedCounts };
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

export function archiveName(now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `capital-command-state-${stamp}.zip`;
}

export type CreatedArchive = { path: string; bytes: number; fileCount: number; manifest: BackupManifest };

export async function createStateArchive(options: {
  dataDir: string;
  rootDir: string;
  target: string;
  now?: Date;
  limits?: BackupLimits;
}): Promise<CreatedArchive> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const now = options.now ?? new Date();
  const collected = await collectStateFiles(options.dataDir, options.rootDir, limits);
  const written: { path: string; bytes: number }[] = [];
  const skipped = [...collected.skipped];
  const built: { manifest?: BackupManifest } = {};

  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const file of collected.included) {
      let data: Buffer;
      try {
        data = await readFile(file.absolute);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "unknown";
        if (code === "ENOENT" && !file.core) {
          skipped.push({ path: file.relative, reason: "removed while the backup was running" });
          continue;
        }
        if (file.core) throw new Error(`Could not read ${file.relative} (${code}); the backup was not written.`);
        skipped.push({ path: file.relative, reason: `unreadable (${code})` });
        continue;
      }
      written.push({ path: file.relative, bytes: data.length });
      yield { name: `data/${file.relative}`, data, modified: file.modified };
    }

    const manifest: BackupManifest = {
      format: 1,
      app: "capital-command",
      createdAt: now.toISOString(),
      host: os.hostname(),
      dataDir: options.dataDir,
      fileCount: written.length,
      totalBytes: written.reduce((sum, file) => sum + file.bytes, 0),
      files: written,
      excludedSecrets: collected.secrets,
      skipped,
      skippedCounts: collected.skippedCounts,
      limits
    };
    built.manifest = manifest;
    yield { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), modified: now };
  }

  await mkdir(path.dirname(options.target), { recursive: true });
  const partial = `${options.target}.partial`;
  try {
    const { bytes } = await writeZip(partial, entries());
    await verifyArchive(partial);
    await rename(partial, options.target);
    return { path: options.target, bytes, fileCount: written.length, manifest: built.manifest! };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyArchive(file: string): Promise<BackupManifest> {
  const archive = openZip(await readFile(file));
  const manifestEntry = archive.entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry) throw new Error("The backup has no manifest.json.");
  const manifest = JSON.parse(archive.read("manifest.json").toString("utf8")) as BackupManifest;
  let stateFiles = 0;
  for (const entry of archive.entries) {
    archive.read(entry.name);
    if (entry.name.startsWith("data/")) stateFiles += 1;
  }
  if (stateFiles !== manifest.fileCount) {
    throw new Error(`The backup holds ${stateFiles} files but its manifest lists ${manifest.fileCount}.`);
  }
  return manifest;
}

export function defaultDriveCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE?.trim() || os.homedir();
  const letters = "DEFHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\My Drive`);
  return ["G:\\My Drive", path.join(home, "Google Drive"), path.join(home, "My Drive"), ...letters];
}

function cleanEnv(value: string | undefined): string {
  return (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

export type ResolvedDestination = {
  dir: string;
  source: "argument" | "BACKUP_DRIVE_DIR" | "CLIPS_DRIVE_DIR" | "auto-detected";
};

function inBackupFolder(base: string): string {
  return path.basename(base).toLowerCase() === BACKUP_FOLDER_NAME.toLowerCase() ? base : path.join(base, BACKUP_FOLDER_NAME);
}

export function resolveBackupDir(options: {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  candidates?: string[];
}): ResolvedDestination | null {
  const env = options.env ?? process.env;
  if (options.explicit?.trim()) return { dir: options.explicit.trim(), source: "argument" };

  for (const name of ["BACKUP_DRIVE_DIR", "CLIPS_DRIVE_DIR"] as const) {
    const base = cleanEnv(env[name]);
    if (!base) continue;
    if (!existsSync(base)) {
      throw new Error(`${name} is set to "${base}" but that folder does not exist. Is Google Drive for desktop running and signed in?`);
    }
    return { dir: inBackupFolder(base), source: name };
  }

  for (const candidate of options.candidates ?? defaultDriveCandidates(env)) {
    if (existsSync(candidate)) return { dir: inBackupFolder(candidate), source: "auto-detected" };
  }
  return null;
}

export const NO_DESTINATION_MESSAGE =
  "No backup destination found. Set BACKUP_DRIVE_DIR in .env to a folder inside Google Drive for desktop " +
  "(for example BACKUP_DRIVE_DIR=G:\\My Drive), or install Google Drive for desktop so it appears at " +
  "G:\\My Drive, %USERPROFILE%\\Google Drive or %USERPROFILE%\\My Drive.";

export async function pruneBackups(dir: string, keep: number = KEEP_BACKUPS): Promise<string[]> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && ARCHIVE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of doomed) await unlink(path.join(dir, name));
  return doomed;
}

export type BackupOptions = {
  dataDir: string;
  rootDir: string;
  destDir?: string;
  env?: NodeJS.ProcessEnv;
  driveCandidates?: string[];
  now?: Date;
  keep?: number;
  limits?: BackupLimits;
};

export type BackupResult =
  | { ok: true; at: string; path: string; bytes: number; fileCount: number; pruned: string[]; warnings: string[]; manifest: BackupManifest }
  | { ok: false; at: string; error: string };

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runStateBackup(options: BackupOptions): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const at = now.toISOString();
  const warnings: string[] = [];

  async function record(status: BackupStatus) {
    try {
      await writeBackupStatus(options.dataDir, status);
    } catch (error) {
      warnings.push(`Could not write backup-status.json: ${reason(error)}`);
    }
  }

  try {
    const destination = resolveBackupDir({ explicit: options.destDir, env: options.env, candidates: options.driveCandidates });
    if (!destination) throw new Error(NO_DESTINATION_MESSAGE);

    const created = await createStateArchive({
      dataDir: options.dataDir,
      rootDir: options.rootDir,
      target: path.join(destination.dir, archiveName(now)),
      now,
      limits: options.limits
    });

    let pruned: string[] = [];
    try {
      pruned = await pruneBackups(destination.dir, options.keep);
    } catch (error) {
      warnings.push(`Could not remove old backups: ${reason(error)}`);
    }

    await record({ at, ok: true, path: created.path, bytes: created.bytes, fileCount: created.fileCount, lastSuccessAt: at });
    return { ok: true, at, path: created.path, bytes: created.bytes, fileCount: created.fileCount, pruned, warnings, manifest: created.manifest };
  } catch (error) {
    const previous = await readBackupStatus(options.dataDir);
    const lastSuccessAt = previous?.ok ? previous.at : previous?.lastSuccessAt;
    await record({ at, ok: false, error: reason(error), ...(lastSuccessAt ? { lastSuccessAt } : {}) });
    return { ok: false, at, error: reason(error) };
  }
}
