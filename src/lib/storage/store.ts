import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataPath } from "@/lib/paths";
import { emptyData, seedData } from "@/lib/mockData/seed";
import { atomicWriteFile } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import { appDataSchema } from "@/lib/storage/schemas";
import { ManagedEditorDeletedError, ManagedEditorCreationConflictError, preserveManagedEditorProjects,
  assertEditorProjectCreation, type TrustedEditorProjectCreation } from "@/lib/integrations/marketing/editor-state";
import type { AppData, ClipProject } from "@/types/domain";
import type { EditorCreationReceipt } from "@/lib/integrations/marketing/editor-types";

const dataFilePath = dataPath("capital-command.json");
let writeQueue = Promise.resolve();

/**
 * How many last-known-good copies to keep. The document is several megabytes,
 * so this is a real cost per copy; three is the newest write plus the two
 * before it, which is enough for a problem noticed a save or two late without
 * turning the data folder into an archive of the same afternoon.
 */
const SNAPSHOT_KEEP = 3;
const snapshotDir = dataPath("snapshots");
const snapshotPrefix = "capital-command-";
const snapshotSuffix = ".json";

async function ensureStore() {
  await mkdir(path.dirname(dataFilePath), { recursive: true });
}

/** A read that could not be trusted. The file is left exactly as it was. */
export class AppDataUnreadableError extends Error {
  constructor(
    message: string,
    readonly copyPath: string | null
  ) {
    super(message);
    this.name = "AppDataUnreadableError";
  }
}

/**
 * The document, or an error — never a fresh start.
 *
 * A file that exists but will not parse used to be answered with `seedData`,
 * AND WRITTEN BACK: one unrecognised field turned every carousel, holding and
 * content item into demo data, silently, with no copy kept. A file that is
 * there and unreadable is a reason to stop, not to replace — the pipeline store
 * has always worked this way (`readRunsFile` leaves itself unloaded). Only a
 * file that genuinely does not exist gets a document written for it, and what
 * gets written is empty: a first run belongs to whoever is having it.
 */
async function readStoredAppData(): Promise<AppData | null> {
  await ensureStore();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await readFile(dataFilePath, "utf8");
      return appDataSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      if (attempt < 2) {
        // A read can land mid-write; the retry is for that, not for damage.
        await new Promise((resolve) => setTimeout(resolve, 40));
        continue;
      }
      const copyPath = await keepCorruptCopy();
      throw new AppDataUnreadableError(
        `The app data file could not be read${copyPath ? ` — the damaged file was copied to ${path.basename(copyPath)} so it can be looked at` : ""}. Nothing has been changed.`,
        copyPath
      );
    }
  }

  throw new AppDataUnreadableError("The app data file could not be read. Nothing has been changed.", null);
}

export async function readAppData(): Promise<AppData> {
  const data = await readStoredAppData();
  if (data) return data;
  // Initialization is queued too: another save may create the document after
  // the missing-file read, and must not then be replaced with an empty one.
  return mutateAppData((current) => current);
}

/** Passive integration read: no initialization, repair, snapshots or corrupt copies. */
export async function readExistingAppData(): Promise<AppData | null> {
  try { return appDataSchema.parse(JSON.parse(await readFile(dataFilePath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AppDataUnreadableError("The existing app data could not be read. Nothing has been changed.", null);
  }
}

/**
 * Best effort: ONE copy PER DAMAGED DOCUMENT to look at later. Every screen and
 * the sidebar's poll read app data, so copying per failed read wrote thousands
 * of copies of a multi-megabyte file in a day — but keying that on "any copy in
 * this folder" meant a second, later corruption got no copy at all and the
 * message named the previous incident's file. The key is the damaged file's own
 * size and mtime, which `stat` gives for free: re-hashing megabytes on a read
 * that has already failed three times buys nothing, and no write can change a
 * file's contents without moving its mtime.
 *
 * Failing to copy must not hide the read failure.
 */
async function keepCorruptCopy(): Promise<string | null> {
  try {
    const info = await stat(dataFilePath);
    const key = `${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}`;
    const folder = path.dirname(dataFilePath);
    const prefix = `${path.basename(dataFilePath)}.unreadable-`;
    const existing = (await readdir(folder)).find((name) => name.startsWith(prefix) && name.endsWith(`.${key}`));
    if (existing) return path.join(folder, existing);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const copyPath = `${dataFilePath}.unreadable-${stamp}.${key}`;
    await copyFile(dataFilePath, copyPath);
    return copyPath;
  } catch {
    return null;
  }
}

async function currentDocumentParses(): Promise<boolean> {
  try {
    appDataSchema.parse(JSON.parse(await readFile(dataFilePath, "utf8")));
    return true;
  } catch {
    return false;
  }
}

/** A verified-parseable copy of the document, kept after a successful save. */
export interface AppDataSnapshot {
  path: string;
  savedAt: string;
  bytes: number;
}

function snapshotSavedAt(name: string): string | null {
  const stamp = name.slice(snapshotPrefix.length, name.length - snapshotSuffix.length);
  const iso = stamp.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z");
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function listSnapshots(): Promise<AppDataSnapshot[]> {
  let names: string[];
  try {
    names = await readdir(snapshotDir);
  } catch {
    return [];
  }

  const snapshots = await Promise.all(
    names
      .filter((name) => name.startsWith(snapshotPrefix) && name.endsWith(snapshotSuffix))
      .map(async (name) => {
        const savedAt = snapshotSavedAt(name);
        if (!savedAt) return null;
        try {
          const info = await stat(path.join(snapshotDir, name));
          return { path: path.join(snapshotDir, name), savedAt, bytes: info.size } satisfies AppDataSnapshot;
        } catch {
          return null;
        }
      })
  );

  return snapshots.filter((entry): entry is AppDataSnapshot => entry !== null).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

async function readSnapshot(snapshot: AppDataSnapshot): Promise<AppData | null> {
  try {
    return appDataSchema.parse(JSON.parse(await readFile(snapshot.path, "utf8")));
  } catch {
    return null;
  }
}

/**
 * The newest copy that still parses. A snapshot is only ever offered after it
 * has been read back and validated here — a copy nobody can load is worse than
 * no offer at all, because pressing the button would replace a damaged document
 * with a damaged document.
 */
export async function latestGoodSnapshot(): Promise<AppDataSnapshot | null> {
  for (const snapshot of await listSnapshots()) {
    if (await readSnapshot(snapshot)) return snapshot;
  }
  return null;
}

/**
 * Written from the SAME serialized payload the document was just committed
 * from, then read back and parsed: the bytes were schema-checked in memory
 * before they were serialized, so what the readback catches is a short or
 * failed disk write. A snapshot that cannot be verified is deleted rather than
 * left to be offered later.
 */
async function keepSnapshot(serialized: string) {
  await mkdir(snapshotDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(snapshotDir, `${snapshotPrefix}${stamp}${snapshotSuffix}`);

  await atomicWriteFile(target, serialized);
  try {
    JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }

  const stale = (await listSnapshots()).slice(SNAPSHOT_KEEP);
  await Promise.all(stale.map((snapshot) => rm(snapshot.path, { force: true })));
}

async function commit(data: AppData, previous?: AppData | null, trustedProjectId?: string, creation?: TrustedEditorProjectCreation, assertCreationCurrent?: () => void): Promise<string> {
  const stored = previous === undefined ? await readExistingAppData() : previous;
  const serialized = JSON.stringify(appDataSchema.parse(preserveManagedEditorProjects(data, stored, trustedProjectId, creation)), null, 2);
  assertCreationCurrent?.();
  await atomicWriteFile(dataFilePath, serialized);
  return serialized;
}

// Writes queued behind this one. A snapshot copies megabytes, so when saves
// arrive in a burst only the last one takes a copy — the others would be
// superseded seconds later anyway.
let queuedWrites = 0;

async function enqueueWrite(commitWrite: () => Promise<string | undefined>) {
  queuedWrites += 1;
  const write = async () => {
    try {
      return await withFileLock(dataFilePath, commitWrite, { reclaimLiveHolder: false });
    } finally {
      queuedWrites -= 1;
    }
  };

  const committed = writeQueue.then(write, write);
  // The snapshot runs inside the queue so it can never read a half-committed
  // document, but the caller does not wait for it and a failure here is never
  // allowed to turn a successful save into a failed one.
  writeQueue = committed.then(
    async (serialized) => {
      if (queuedWrites > 0 || serialized === undefined) return;
      await keepSnapshot(serialized).catch(() => undefined);
    },
    () => undefined
  );
  await committed;
}

export async function writeAppData(data: AppData) {
  await enqueueWrite(() => commit(data));
}

/**
 * Read, change and commit one document inside this process's existing write
 * queue. The synchronous updater sees every write ahead of it, so concurrent
 * append operations cannot replace each other's additions. It must not call
 * store writes itself. The write also holds a lock file, so a CLI changing the
 * same document in another process waits its turn instead of interleaving.
 */
export async function mutateAppData(update: (current: AppData) => AppData): Promise<AppData> {
  let updated!: AppData;
  await enqueueWrite(async () => {
    // Read directly here: readAppData's missing-file initializer would enqueue
    // another write behind this one and wait on itself. Clone the empty schema
    // defaults so an updater can never change the shared first-run template.
    const current = (await readStoredAppData()) ?? appDataSchema.parse(emptyData);
    // Existing callers may mutate the document in place. Keep the managed
    // project baseline separate so those edits cannot alter their own CAS
    // comparison or forge enrollment/receipts in the previous document.
    const previous = { ...current, clipProjects: current.clipProjects.map((project) =>
      project.marketingEditor ? structuredClone(project) : { ...project }) };
    const serialized = await commit(update(current), previous);
    updated = appDataSchema.parse(JSON.parse(serialized));
    return serialized;
  });
  return updated;
}

/**
 * Existing project only, inside the same document queue and OS lock as legacy
 * writes. The callback is an owner-process integration port, never an HTTP body.
 * Metadata enrollment/receipts are accepted only from this explicit transition.
 */
export type CreatedClipProjectGuard = { rootProjectId: string;
  assertCurrentRoot(root: Readonly<ClipProject>, child: Readonly<ClipProject>): void };
export async function mutateExistingClipProject(
  id: string, update: (project: ClipProject) => ClipProject, guard?: CreatedClipProjectGuard
): Promise<ClipProject> {
  let result!: ClipProject;
  await enqueueWrite(async () => {
    const current = await readExistingAppData();
    const matches = current?.clipProjects.filter((project) => project.id === id) ?? [];
    const stored = matches[0];
    if (!current || !stored || matches.length !== 1) throw new Error("The existing editor project could not be uniquely identified.");
    if (stored.marketingEditor?.deletedAt) throw new ManagedEditorDeletedError();
    if (guard) {
      const roots = current.clipProjects.filter((project) => project.id === guard.rootProjectId);
      if (roots.length !== 1) throw new ManagedEditorCreationConflictError();
      guard.assertCurrentRoot(structuredClone(roots[0]), structuredClone(stored));
    }
    result = update(structuredClone(stored));
    if (result.id !== id) throw new Error("An editor transaction cannot change project identity.");
    const updated = { ...current, clipProjects: current.clipProjects.map((project) => project.id === id ? result : project) };
    return commit(updated, current, id);
  });
  return result;
}

export type EditorProjectCreationCommit = { root: ClipProject; child: ClipProject | null;
  receipt: EditorCreationReceipt; replayed: boolean };
/**
 * One existing root receipt and one server-ID child in the original document.
 * This private owner-process builder is never supplied by an HTTP request.
 */
export async function createClipProjectFromRoot(
  rootId: string, commandId: string, payloadSha256: string,
  create: (root: ClipProject, childId: string) => Promise<{ root: ClipProject; child: ClipProject; assertCurrent(): void }>
): Promise<EditorProjectCreationCommit> {
  let result!: EditorProjectCreationCommit;
  await enqueueWrite(async () => {
    const current = await readExistingAppData();
    const roots = current?.clipProjects.filter((project) => project.id === rootId) ?? [];
    if (!current || roots.length !== 1) throw new ManagedEditorCreationConflictError();
    const original = roots[0];
    const receipts = original.marketingEditor?.receipts.filter((entry) => entry.result.commandId === commandId) ?? [];
    if (receipts.length > 1) throw new ManagedEditorCreationConflictError();
    if (receipts.length) {
      const prior = receipts[0];
      if (prior.payloadSha256 !== payloadSha256 || prior.result.operation !== "create_editor_project_from_source") throw new ManagedEditorCreationConflictError();
      const receipt = prior.result;
      const children = current.clipProjects.filter((project) => project.id === receipt.createdProjectId);
      if (children.length > 1) throw new ManagedEditorCreationConflictError();
      result = { root: structuredClone(original), child: children[0] ? structuredClone(children[0]) : null,
        receipt: structuredClone(prior.result), replayed: true };
      return undefined; // Receipt replay does not replace data or create a snapshot.
    }
    if (original.marketingEditor?.deletedAt) throw new ManagedEditorDeletedError();
    const childId = `clip-${randomUUID()}`;
    if (current.clipProjects.some((project) => project.id === childId)) throw new ManagedEditorCreationConflictError();
    const next = await create(structuredClone(original), childId);
    if (next.root.id !== rootId || next.child.id !== childId) throw new ManagedEditorCreationConflictError();
    assertEditorProjectCreation(original, next.root, next.child);
    const appended = next.root.marketingEditor!.receipts.at(-1)!;
    if (appended.result.operation !== "create_editor_project_from_source" || appended.result.commandId !== commandId
      || appended.payloadSha256 !== payloadSha256) throw new ManagedEditorCreationConflictError();
    const updated = { ...current, clipProjects: [next.child, ...current.clipProjects.map((project) => project.id === rootId ? next.root : project)] };
    const serialized = await commit(updated, current, rootId, { rootProjectId: rootId, childProjectId: childId }, next.assertCurrent);
    result = { root: structuredClone(next.root), child: structuredClone(next.child), receipt: structuredClone(appended.result), replayed: false };
    return serialized;
  });
  return result;
}

/**
 * Put the last known-good copy back. Only ever called from an explicit action a
 * person took: this is the one path in the app allowed to write over a document
 * it could not read, and it validates the copy before it replaces anything.
 */
export async function restoreLastGoodSnapshot(): Promise<{ snapshot: AppDataSnapshot; data: AppData }> {
  const snapshot = await latestGoodSnapshot();
  if (!snapshot) throw new Error("There is no verified copy of your data file to restore from.");

  const data = await readSnapshot(snapshot);
  if (!data) throw new Error("The saved copy could not be read, so nothing has been changed.");

  // Keep the document that is about to be replaced, unless it is fine — a
  // readable file copied to `.unreadable-…` would be evidence of nothing.
  if (!(await currentDocumentParses())) await keepCorruptCopy();

  const restore = () => withFileLock(dataFilePath, async () => {
    // This explicit recovery path also works when the current document cannot
    // parse. A readable document still protects current managed receipts.
    const previous = await readExistingAppData().catch(() => null);
    return commit(data, previous);
  }, { reclaimLiveHolder: false });
  const done = writeQueue.then(restore, restore);
  writeQueue = done.then(
    () => undefined,
    () => undefined
  );
  await done;
  return { snapshot, data };
}

export async function resetAppData() {
  await writeAppData(seedData);
  return seedData;
}
