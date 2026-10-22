import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceDir, sourceFilePath, type SourceMeta } from "@/lib/clipping/sources";
import { transactMarketingPreparation } from "./runs";

export type MarketingPreparationCommand = {
  operation: "prepare_source";
  commandId: string;
  runId: string;
  expectedRevision: number;
  sourceId: string;
};

/** Supplied by the trusted owner/upload registry, NEVER by a command body. */
export type PreparationSourceAccess = { ownerId: string; sourceIds: ReadonlySet<string> };
export type MarketingPreparationStatus = "requested" | "claimed" | "running" | "prepared" | "failed" | "uncertain";
export type PreparationSourceIdentity = {
  sourceId: string;
  sha256: string;
  metadataSha256: string;
  sizeBytes: number;
};
export type PreparedReviewProxy = {
  kind: "local_review_proxy";
  sourceId: string;
  sourceSha256: string;
  /** Relative to the original uploaded source directory. */
  fileName: string;
  sha256: string;
  sizeBytes: number;
  durationSec: number;
};
export type MarketingPreparationRecord = {
  command: MarketingPreparationCommand;
  requestDigest: string;
  /** Immutable accepted revision; progress transitions never change it. */
  revision: number;
  snapshot: { revision: number; source: PreparationSourceIdentity };
  status: MarketingPreparationStatus;
  requestedAt: string;
  updatedAt: string;
  history: { status: MarketingPreparationStatus; at: string }[];
  claim?: { token: string; workerInstance: string; at: string };
  output?: PreparedReviewProxy;
  error?: string;
};
export type MarketingPreparationReceipt = {
  runId: string;
  commandId: string;
  revision: number;
  status: MarketingPreparationStatus;
  persisted: true;
  replayed: boolean;
  output?: PreparedReviewProxy;
  error?: string;
};

export class MarketingPreparationConflict extends Error {
  readonly code = "conflict";
}
export class MarketingPreparationAccessError extends Error {
  readonly code = "forbidden";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ACTIVE = new Set<MarketingPreparationStatus>(["requested", "claimed", "running"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();

function assertCommand(command: MarketingPreparationCommand) {
  if (command.operation !== "prepare_source" || !UUID.test(command.commandId) ||
      !/^site-[0-9a-f-]{36}$/i.test(command.runId) || !SOURCE_ID.test(command.sourceId) ||
      !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new Error("Preparation requires a command UUID, managed source, uploaded source and exact revision.");
  }
}

function assertAccess(ownerId: string, sourceId: string, access: PreparationSourceAccess) {
  if (!ownerId.trim() || access?.ownerId !== ownerId || !access.sourceIds?.has(sourceId)) {
    throw new MarketingPreparationAccessError("That uploaded source is not allowed for this owner.");
  }
}

async function fileHash(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

/** Ownership is checked before metadata or file access, including replay/dispatch. */
async function sourceIdentity(ownerId: string, sourceId: string, access: PreparationSourceAccess): Promise<{
  identity: PreparationSourceIdentity; meta: SourceMeta; file: string;
}> {
  assertAccess(ownerId, sourceId, access);
  const root = await realpath(dataPath("clips", "sources"));
  const directory = await realpath(sourceDir(sourceId));
  if (!isInside(root, directory)) throw new MarketingPreparationConflict("Uploaded source path escaped the source store.");
  const metadataFile = await realpath(path.join(directory, "meta.json"));
  if (!isInside(directory, metadataFile)) throw new MarketingPreparationConflict("Uploaded source metadata escaped its directory.");
  const meta = await readSourceMeta(sourceId);
  if (!meta || meta.id !== sourceId || path.basename(meta.storedName) !== meta.storedName ||
      !/^source\.(mp4|mov|mkv|webm|avi)$/i.test(meta.storedName) ||
      !Number.isFinite(meta.durationSec) || meta.durationSec <= 0) {
    throw new MarketingPreparationConflict("That uploaded video is unavailable or has invalid metadata.");
  }
  const file = await realpath(sourceFilePath(meta));
  if (!isInside(directory, file)) throw new MarketingPreparationConflict("Uploaded media escaped its source directory.");
  const before = await stat(file);
  if (!before.isFile() || before.size <= 0) throw new MarketingPreparationConflict("That uploaded video is empty or unavailable.");
  const sha256 = await fileHash(file);
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new MarketingPreparationConflict("Uploaded source changed while its identity was being recorded.");
  }
  return {
    file, meta,
    identity: { sourceId, sha256, metadataSha256: hash(JSON.stringify(meta)), sizeBytes: after.size }
  };
}

function receipt(record: MarketingPreparationRecord, replayed: boolean): MarketingPreparationReceipt {
  return {
    runId: record.command.runId, commandId: record.command.commandId,
    revision: record.revision, status: record.status, persisted: true, replayed,
    ...(record.output ? { output: structuredClone(record.output) } : {}),
    ...(record.error ? { error: record.error } : {})
  };
}

/** Saves intent and exact local content in the existing runs.json; starts no work. */
export async function requestMarketingPreparation(
  ownerId: string, command: MarketingPreparationCommand, access: PreparationSourceAccess
): Promise<MarketingPreparationReceipt> {
  assertCommand(command);
  assertAccess(ownerId, command.sourceId, access);
  const requestDigest = hash(JSON.stringify({ ownerId, operation: command.operation, commandId: command.commandId,
    runId: command.runId, expectedRevision: command.expectedRevision, sourceId: command.sourceId }));
  return transactMarketingPreparation(ownerId, command.runId, async (source, owned) => {
    for (const row of owned) {
      if (row.marketingSource?.commandId === command.commandId) throw new MarketingPreparationConflict("Command id was already used for another operation.");
      const saved = row.marketingSource?.preparations?.find((entry) => entry.command.commandId === command.commandId);
      if (!saved) continue;
      if (saved.requestDigest !== requestDigest) throw new MarketingPreparationConflict("Command id was already used with different arguments.");
      return { result: receipt(saved, true) };
    }
    const revision = source.revision ?? source.receipt.revision;
    if (revision !== command.expectedRevision) throw new MarketingPreparationConflict("Source revision changed. Refresh before preparing.");
    if (source.preparations?.some((entry) => ACTIVE.has(entry.status))) {
      throw new MarketingPreparationConflict("This source already has a preparation request in progress.");
    }
    const { identity } = await sourceIdentity(ownerId, command.sourceId, access);
    const at = now();
    const record: MarketingPreparationRecord = {
      command: structuredClone(command), requestDigest, revision: revision + 1,
      snapshot: { revision, source: identity }, status: "requested", requestedAt: at, updatedAt: at,
      history: [{ status: "requested", at }]
    };
    return { next: { revision: record.revision, preparations: [...(source.preparations ?? []), record] }, result: receipt(record, false) };
  });
}

type PermitDetails = {
  ownerId: string; command: MarketingPreparationCommand; access: PreparationSourceAccess;
  workerInstance: string; expiresAt: number;
};
declare const permitBrand: unique symbol;
export type MarketingPreparationPermit = { readonly [permitBrand]: true };
type WorkerGlobal = typeof globalThis & {
  __marketingPreparationWorker?: { instance: string; active: Set<string>; permits: WeakMap<object, PermitDetails> };
};
const worker = ((globalThis as WorkerGlobal).__marketingPreparationWorker ??= {
  instance: randomUUID(), active: new Set<string>(), permits: new WeakMap<object, PermitDetails>()
});

/**
 * INTERNAL owning-process hook after trusted authorization. This permit has no
 * publication, provider, download or scheduling capability and cannot be sent
 * across HTTP, serialized, or reconstructed in a second process.
 */
export function createMarketingPreparationPermit(
  ownerId: string, command: MarketingPreparationCommand, access: PreparationSourceAccess,
  scope: { prepare: true; publish: false; schedule: false }
): MarketingPreparationPermit {
  assertCommand(command);
  assertAccess(ownerId, command.sourceId, access);
  if (scope?.prepare !== true || scope.publish !== false || scope.schedule !== false) {
    throw new MarketingPreparationAccessError("An explicit preparation-only permit is required.");
  }
  const permit = Object.freeze({}) as MarketingPreparationPermit;
  worker.permits.set(permit, {
    ownerId, command: structuredClone(command), access: { ownerId, sourceIds: new Set(access.sourceIds) },
    workerInstance: worker.instance, expiresAt: Date.now() + 5 * 60_000
  });
  return permit;
}

function permitDetails(ownerId: string, runId: string, commandId: string, permit: MarketingPreparationPermit): PermitDetails {
  const details = permit && worker.permits.get(permit);
  if (!details || details.ownerId !== ownerId || details.command.runId !== runId || details.command.commandId !== commandId ||
      details.workerInstance !== worker.instance || details.expiresAt < Date.now()) {
    throw new MarketingPreparationAccessError("A current owning-process preparation-only permit is required.");
  }
  return details;
}

async function transition(
  ownerId: string, runId: string, commandId: string,
  change: (record: MarketingPreparationRecord, revision: number) => MarketingPreparationRecord
): Promise<MarketingPreparationReceipt> {
  return transactMarketingPreparation(ownerId, runId, async (source) => {
    const index = source.preparations?.findIndex((entry) => entry.command.commandId === commandId) ?? -1;
    if (index < 0) throw new MarketingPreparationConflict("No persisted preparation request exists for this command.");
    const records = source.preparations!;
    const saved = records[index];
    const changed = change(saved, source.revision ?? source.receipt.revision);
    if (changed === saved) return { result: receipt(saved, true) };
    const at = now();
    records[index] = { ...changed, updatedAt: at, history: [...saved.history, { status: changed.status, at }] };
    return { next: { revision: source.revision, preparations: records }, result: receipt(records[index], false) };
  });
}

/** Concrete local renderer over the original uploaded source + FFmpeg seams. */
async function renderReviewProxy(details: PermitDetails, record: MarketingPreparationRecord): Promise<PreparedReviewProxy> {
  const before = await sourceIdentity(details.ownerId, record.command.sourceId, details.access);
  if (JSON.stringify(before.identity) !== JSON.stringify(record.snapshot.source)) {
    throw new MarketingPreparationConflict("Uploaded source content changed after the preparation request.");
  }
  const fileName = `marketing-preparation/${record.command.runId}/${record.command.commandId}/review.mp4`;
  const output = path.join(sourceDir(record.command.sourceId), ...fileName.split("/"));
  await mkdir(path.dirname(output), { recursive: true });
  const sourceRoot = await realpath(sourceDir(record.command.sourceId));
  const outputRoot = await realpath(path.dirname(output));
  if (!isInside(sourceRoot, outputRoot)) throw new MarketingPreparationConflict("Preparation output escaped its source directory.");
  // Never follow a pre-existing output link to a file outside this directory.
  const existingOutput = await realpath(output).catch(() => undefined);
  if (existingOutput && !isInside(outputRoot, existingOutput)) throw new MarketingPreparationConflict("Preparation output escaped its command directory.");
  // All paths/arguments originate from the bound source or generated command.
  // Restrict demuxers/protocols and strip audio; no provider or queue is involved.
  await runFfmpeg([
    "-hide_banner", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
    "-format_whitelist", "mov,matroska,webm,avi", "-i", before.file,
    "-t", String(Math.min(30, before.meta.durationSec)), "-an", "-map", "0:v:0",
    "-vf", "scale=w='min(640,iw)':h=-2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-movflags", "+faststart", output
  ]);
  const after = await sourceIdentity(details.ownerId, record.command.sourceId, details.access);
  if (JSON.stringify(after.identity) !== JSON.stringify(record.snapshot.source)) {
    throw new MarketingPreparationConflict("Uploaded source content changed during preparation.");
  }
  const info = await stat(output);
  const durationSec = await probeDuration(output);
  if (!info.isFile() || info.size <= 0 || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 31) {
    throw new Error("The local review proxy did not produce a valid bounded video.");
  }
  return { kind: "local_review_proxy", sourceId: record.command.sourceId, sourceSha256: before.identity.sha256,
    fileName, sha256: await fileHash(output), sizeBytes: info.size, durationSec };
}

/**
 * INTERNAL worker hook. Never wire to public HTTP/heartbeat/full advanceRun.
 * Persist claim AND running before dispatch. An orphaned or unacknowledged
 * claim is uncertain and can never execute again under the same command.
 */
export async function processMarketingPreparation(
  ownerId: string, runId: string, commandId: string, permit: MarketingPreparationPermit
): Promise<MarketingPreparationReceipt> {
  const details = permitDetails(ownerId, runId, commandId, permit);
  const key = `${runId}:${commandId}`;
  if (worker.active.has(key)) {
    return transition(ownerId, runId, commandId, (record) => record);
  }
  worker.active.add(key);
  let claimed = false;
  let selected = false;
  let dispatched = false;
  let renderCompleted = false;
  const token = randomUUID();
  try {
    const claim = await transition(ownerId, runId, commandId, (record, revision) => {
      if (!ACTIVE.has(record.status)) return record;
      if (record.status !== "requested") return { ...record, status: "uncertain", error: "The previous worker claim has no confirmed outcome. It was fenced from replay." };
      if (revision !== record.revision || (Object.keys(record.command) as (keyof MarketingPreparationCommand)[])
        .some((field) => details.command[field] !== record.command[field])) {
        throw new MarketingPreparationConflict("Preparation target revision or command changed before claim.");
      }
      selected = true;
      return { ...record, status: "claimed", claim: { token, workerInstance: worker.instance, at: now() } };
    });
    claimed = selected;
    if (!claimed) return claim;
    let current: MarketingPreparationRecord | undefined;
    await transition(ownerId, runId, commandId, (record, revision) => {
      if (record.status !== "claimed" || record.claim?.token !== token || record.revision !== revision) {
        throw new MarketingPreparationConflict("Preparation claim is stale.");
      }
      current = { ...record, status: "running" };
      return current;
    });
    dispatched = true;
    const output = await renderReviewProxy(details, current!);
    renderCompleted = true;
    return await transition(ownerId, runId, commandId, (record, revision) => {
      if (record.status !== "running" || record.claim?.token !== token || record.revision !== revision) {
        throw new MarketingPreparationConflict("Preparation completion was fenced by a stale claim.");
      }
      return { ...record, status: "prepared", output };
    });
  } catch (error) {
    if (!claimed) throw error;
    const message = error instanceof MarketingPreparationConflict ? error.message :
      renderCompleted ? "Local preparation did not confirm a saved output. Review before requesting again."
      : dispatched ? "The local review proxy could not be rendered. Review the uploaded video before requesting again."
      : "Preparation could not persist its running state.";
    // Failure to save any outcome propagates: never return persisted:true based
    // on a mutated in-memory row or redispatch an unacknowledged command.
    return await transition(ownerId, runId, commandId, (record) => {
      if (record.claim?.token !== token || !ACTIVE.has(record.status)) return record;
      return { ...record, status: renderCompleted && !(error instanceof MarketingPreparationConflict) ? "uncertain" : "failed", error: message };
    });
  } finally {
    worker.active.delete(key);
  }
}
