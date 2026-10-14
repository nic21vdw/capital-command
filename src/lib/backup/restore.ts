import { connect } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  archiveName,
  collectStateFiles,
  type BackupManifest,
  type ManifestSecret
} from "@/lib/backup/state-backup";
import { openZip, writeZip, type ZipArchive } from "@/lib/backup/zip";
import { atomicWriteFile } from "@/lib/storage/atomic-json";

export const APP_PORT = 3000;

export function isPortAnswering(port: number, hosts: string[] = ["127.0.0.1", "::1"], timeoutMs = 1500): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ port, host });
      const finish = (answered: boolean) => {
        socket.destroy();
        resolve(answered);
      };
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
  return Promise.all(hosts.map(probe)).then((results) => results.some(Boolean));
}

export type RestoreOptions = {
  archive: string;
  dataDir: string;
  rootDir: string;
  live?: boolean;
  port?: number;
  stagingDir?: string;
  now?: Date;
};

export type RestoreResult = {
  archive: string;
  live: boolean;
  stagingDir: string;
  manifest: BackupManifest;
  added: string[];
  changed: string[];
  unchanged: number;
  notInBackup: string[];
  secrets: ManifestSecret[];
  applied: string[];
  safetyArchive?: string;
};

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkEntryNames(archive: ZipArchive) {
  for (const entry of archive.entries) {
    const segments = entry.name.split("/");
    const unsafe =
      entry.name.includes("\\") ||
      entry.name.startsWith("/") ||
      /^[a-zA-Z]:/.test(entry.name) ||
      segments.some((segment) => segment === ".." || segment === "." || segment === "");
    const known = entry.name === "manifest.json" || entry.name.startsWith("data/");
    if (unsafe || !known) throw new Error(`The backup contains an unsafe path (${entry.name}) that would land outside the restore folder; nothing was extracted.`);
  }
}

async function sameBytes(file: string, expected: Buffer): Promise<boolean | null> {
  try {
    const current = await readFile(file);
    return current.equals(expected);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function stamp(now: Date): string {
  return archiveName(now).replace("capital-command-state-", "").replace(".zip", "");
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const live = options.live === true;
  const port = options.port ?? APP_PORT;
  const now = options.now ?? new Date();

  if (live && (await isPortAnswering(port))) {
    throw new Error(
      `The app is answering on port ${port}. Stop the app first (scripts\\stop-server.ps1), then run the restore again; restoring under a running server would be overwritten at its next save.`
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(options.archive);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Backup file not found: ${options.archive}`);
    throw error;
  }
  const archive = openZip(bytes);
  if (!archive.entries.some((entry) => entry.name === "manifest.json")) {
    throw new Error(`${options.archive} has no manifest.json, so it is not a state backup made by npm run backup:state.`);
  }
  checkEntryNames(archive);
  const manifest = JSON.parse(archive.read("manifest.json").toString("utf8")) as BackupManifest;

  const stagingDir = path.resolve(
    options.stagingDir ??
      path.join(options.rootDir, "backups", "restore-staging", path.basename(options.archive, path.extname(options.archive)))
  );
  if (isInside(options.dataDir, stagingDir) || isInside(stagingDir, options.dataDir)) {
    throw new Error("The staging folder must be separate from data/.");
  }

  await rm(stagingDir, { recursive: true, force: true });
  for (const entry of archive.entries) {
    const target = path.join(stagingDir, ...entry.name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, archive.read(entry.name));
  }

  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  const backedUp = new Set<string>();
  for (const entry of archive.entries) {
    if (!entry.name.startsWith("data/")) continue;
    const relative = entry.name.slice("data/".length);
    backedUp.add(relative);
    const same = await sameBytes(path.join(options.dataDir, ...relative.split("/")), archive.read(entry.name));
    if (same === null) added.push(relative);
    else if (same) unchanged += 1;
    else changed.push(relative);
  }
  added.sort();
  changed.sort();

  const present = await collectStateFiles(options.dataDir, options.rootDir);
  const notInBackup = present.included.map((file) => file.relative).filter((relative) => !backedUp.has(relative));

  const result: RestoreResult = {
    archive: options.archive,
    live,
    stagingDir,
    manifest,
    added,
    changed,
    unchanged,
    notInBackup,
    secrets: manifest.excludedSecrets ?? [],
    applied: []
  };
  if (!live) return result;

  if (changed.length > 0) {
    const safetyArchive = path.join(options.rootDir, "backups", `pre-restore-${stamp(now)}.zip`);
    await mkdir(path.dirname(safetyArchive), { recursive: true });
    await writeZip(
      safetyArchive,
      (async function* () {
        for (const relative of changed) {
          yield { name: `data/${relative}`, data: await readFile(path.join(options.dataDir, ...relative.split("/"))) };
        }
      })()
    );
    result.safetyArchive = safetyArchive;
  }

  for (const relative of [...added, ...changed]) {
    const target = path.join(options.dataDir, ...relative.split("/"));
    try {
      await atomicWriteFile(target, await readFile(path.join(stagingDir, "data", ...relative.split("/"))));
      result.applied.push(relative);
    } catch (error) {
      throw new Error(`Restore stopped at ${relative}: ${error instanceof Error ? error.message : String(error)}. Files already restored: ${result.applied.length}.`);
    }
  }
  result.applied.sort();
  return result;
}

function list(title: string, items: string[], limit = 40): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, limit).map((item) => `  ${item}`);
  if (items.length > limit) shown.push(`  ... and ${items.length - limit} more`);
  return [`${title} (${items.length}):`, ...shown];
}

export function formatRestoreReport(result: RestoreResult): string {
  const lines = [
    `Backup:        ${result.archive}`,
    `Taken:         ${result.manifest.createdAt} (${result.manifest.fileCount} files)`,
    `Extracted to:  ${result.stagingDir}`,
    ""
  ];
  if (result.live) {
    lines.push(...list("Restored into data/", result.applied));
    if (result.safetyArchive) lines.push(`Previous versions of the changed files were saved to: ${result.safetyArchive}`);
    else lines.push("No existing file was overwritten.");
  } else {
    lines.push(...list("Would change", result.changed));
    lines.push(...list("Would add", result.added));
    if (result.changed.length === 0 && result.added.length === 0) lines.push("Nothing would change: data/ already matches this backup.");
  }
  lines.push(`Unchanged: ${result.unchanged}`);
  if (result.notInBackup.length > 0) lines.push(`In data/ but not in this backup (left alone): ${result.notInBackup.length}`);

  lines.push("", "Secrets are never backed up. Reconnect these after restoring:");
  if (result.secrets.length === 0) lines.push("  (the manifest lists none)");
  for (const secret of result.secrets) lines.push(`  ${secret.path}${secret.present ? "" : " (was not present)"}: ${secret.reconnect}`);

  if (!result.live) {
    lines.push(
      "",
      "Nothing in data/ was touched. To apply this backup, stop the app and run:",
      `  npm run backup:restore -- "${result.archive}" --live`
    );
  }
  return lines.join("\n");
}
