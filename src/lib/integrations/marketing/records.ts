import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataPath, dataRoot } from "@/lib/paths";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { ExportRecord } from "@/lib/clipping/export";
import type { SourceMeta } from "@/lib/clipping/sources";
import type { PipelineRun } from "@/lib/pipeline/types";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import { hasBufferDeliveryEvidence, hasDeliveryEvidence } from "./projection";
import { allowedMediaType, isContainedMediaPath, type ExistingMediaSource, type ProtectedMediaGrant } from "./media";

/** Assigned by a trusted authenticated server boundary, NEVER by request args. */
export type TrustedExistingRecordScope = {
  ownerId: string;
  sourceIds: readonly string[];
  runIds: readonly string[];
  clipJobIds: readonly string[];
  queueIds: readonly string[];
  exportIds?: readonly string[];
  /** Queue rows require BOTH explicit row enrollment and the platform account. */
  accountIds: Partial<Record<PlatformId, readonly string[]>>;
};

export type ExistingStoreReport = {
  store: "sources" | "runs" | "clip_jobs" | "queue" | "clip_exports";
  recordId?: string;
  state: "not_requested" | "not_configured" | "loaded" | "missing" | "unavailable";
  reason?: "malformed" | "unreadable" | "outside_root" | "too_large" | "changed";
};
export type ExistingMediaReference = { id: string; sourceType: ExistingMediaSource; contentType: string };
export type ExistingOutput = {
  id: string; jobId?: string; clipId?: string; queueId?: string;
  kind: ExistingMediaSource; status: "reported_available";
  media: ExistingMediaReference;
};
export type ExistingRecordsWorkspace = {
  connection: { state: "read_only" | "unavailable"; message: string };
  /** Saved state only; no GET poller, recovery, render, enqueue or publication. */
  snapshot: "persisted_records";
  truncated: boolean;
  stores: ExistingStoreReport[];
  sources: { id: string; title: string; sourceUrl?: string; durationSec?: number; width?: number; height?: number; media?: ExistingMediaReference }[];
  runs: { id: string; title: string; status: string; sourceId?: string; clipJobId?: string; progress?: number; createdAt?: string; updatedAt?: string; error?: string }[];
  clipJobs: { id: string; title: string; status: string; stage: string; sourceId?: string; progress?: number; createdAt?: string; error?: string }[];
  clips: { id: string; jobId: string; sourceId?: string; title: string; caption?: string; start: number; end: number; status: "reported_ready" | "reported_preview" | "not_rendered"; outputIds: string[] }[];
  outputs: ExistingOutput[];
  exports: { id: string; jobId: string; clipId?: string; status: string; progress?: number; createdAt?: string; media?: ExistingMediaReference; error?: string }[];
  schedules: {
    id: string; queueId: string; jobId?: string; runId?: string; title: string; caption?: string;
    platform: PlatformId; accountId: string; scheduledAt?: string; reportedStatus: string; status: string;
    publishedUrlVerified: false; media?: ExistingMediaReference; error?: string;
  }[];
};

export type ExistingRecordReaderConfig = {
  resolveScope: (authenticatedOwnerId: string) => TrustedExistingRecordScope | null | Promise<TrustedExistingRecordScope | null>;
  /** Passive snapshot from the authoritative queue owner; no load/save/repair. */
  readQueueSnapshot?: () => unknown | Promise<unknown>;
  /** ExportRecord is otherwise in-memory only. Must copy an ALREADY loaded map. */
  readClipExports?: () => unknown | Promise<unknown>;
};

const PLATFORMS: readonly PlatformId[] = ["youtube", "instagram", "tiktok", "facebook"];
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_GRANTS = 500;
const MAX_ROWS = 10_000;
const MAX_CLIPS = 500;
const MAX_OUTPUTS = 5_000;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
type ObjectRow = Record<string, unknown>;
const object = (value: unknown): value is ObjectRow => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown): boolean => value === undefined || text(value);
function date(value: unknown): string | undefined { return text(value) && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function percent(value: unknown): number | undefined { return finite(value) ? Math.min(100, value) : undefined; }
function sourceUrl(value: unknown): string | undefined {
  if (!text(value) || value.length > 2048) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.href : undefined; }
  catch { return undefined; }
}

/** Text remains useful, while common credential/path carriers never cross. */
export function existingDisplayText(value: unknown, maximum = 4_000): string | undefined {
  if (!text(value)) return undefined;
  return value.slice(0, maximum)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/(?:https?:\/\/|file:\/\/|upload:\/\/)[^\s<>"']+/gi, (url) => sourceUrl(url) ?? "[private link]")
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[private path]")
    .replace(/(^|\s)(?:\.\.?[\\/]|\/)[^\s<>"']+/gi, "$1[private path]")
    .replace(/\b(?:Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, "[credential]")
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|authorization)\b["']?\s*[=:]\s*["']?[^\s,"';]+["']?/gi, "[credential]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[credential]")
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]{16,})\b/g, "[credential]")
    .trim() || undefined;
}

function validScope(value: unknown, owner: string): value is TrustedExistingRecordScope {
  if (!object(value) || value.ownerId !== owner || !object(value.accountIds)) return false;
  for (const key of ["sourceIds", "runIds", "clipJobIds", "queueIds", "exportIds"] as const) {
    const values = value[key];
    if (key === "exportIds" && values === undefined) continue;
    if (!Array.isArray(values) || values.length > MAX_GRANTS || !values.every(id) || new Set(values).size !== values.length) return false;
  }
  return Object.entries(value.accountIds).every(([platform, values]) => PLATFORMS.includes(platform as PlatformId)
    && Array.isArray(values) && values.length <= MAX_GRANTS && values.every(id) && new Set(values).size === values.length);
}

type Result<T> = { report: ExistingStoreReport; value?: T };
const missing = (store: ExistingStoreReport["store"], state: ExistingStoreReport["state"] = "not_requested"): Result<never> => ({ report: { store, state } });
function signature(info: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

async function readJson(store: ExistingStoreReport["store"], segments: string[]): Promise<Result<unknown>> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let reason: ExistingStoreReport["reason"] = "unreadable";
  try {
    const root = await realpath(dataRoot());
    const file = await realpath(dataPath(...segments));
    if (!isContainedMediaPath(root, file)) return { report: { store, state: "unavailable", reason: "outside_root" } };
    if (path.relative(path.resolve(root, ...segments), file) !== "") return { report: { store, state: "unavailable", reason: "unreadable" } };
    handle = await open(file, "r");
    const before = await handle.stat();
    if (!before.isFile()) throw new Error();
    if (before.size > MAX_JSON_BYTES) return { report: { store, state: "unavailable", reason: "too_large" } };
    const chunks: Buffer[] = [];
    let count = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, MAX_JSON_BYTES + 1 - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > MAX_JSON_BYTES) return { report: { store, state: "unavailable", reason: "too_large" } };
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (signature(before) !== signature(await handle.stat()) || signature(before) !== signature(await stat(file))
      || await realpath(dataPath(...segments)) !== file) {
      return { report: { store, state: "unavailable", reason: "changed" } };
    }
    reason = "malformed";
    return { report: { store, state: "loaded" }, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch (error) {
    return { report: (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { store, state: "missing" } : { store, state: "unavailable", reason } };
  } finally { await handle?.close().catch(() => undefined); }
}

function arrayResult<T>(result: Result<unknown>, validate: (row: unknown) => boolean): Result<T[]> {
  if (result.report.state !== "loaded") return { report: result.report };
  if (!Array.isArray(result.value) || result.value.length > MAX_ROWS || !result.value.every(validate)
    || new Set(result.value.map((row: ObjectRow) => row.id)).size !== result.value.length) {
    return { report: { ...result.report, state: "unavailable", reason: "malformed" } };
  }
  return { report: result.report, value: result.value as T[] };
}

function validClip(value: unknown): boolean {
  return object(value) && id(value.id) && finite(value.start) && finite(value.end) && value.end >= value.start
    && ["file", "previewFile", "downloadFile", "editedFile", "posterFile", "title"].every((key) => optionalText(value[key]));
}
function validJob(value: unknown): boolean {
  return object(value) && id(value.id) && text(value.fileName) && optionalText(value.sourceId)
    && ["queued", "processing", "done", "error"].includes(String(value.status))
    && ["downloading", "analyzing", "selecting", "rendering", "finished"].includes(String(value.stage))
    && Array.isArray(value.clips) && value.clips.length <= MAX_CLIPS && value.clips.every(validClip)
    && new Set(value.clips.map((clip) => clip.id)).size === value.clips.length;
}
function validRun(value: unknown): boolean {
  return object(value) && id(value.id) && text(value.name) && ["draft", "ingesting", "running", "error"].includes(String(value.status))
    && optionalText(value.sourceId) && optionalText(value.clipJobId);
}
function validQueue(value: unknown): boolean {
  if (!object(value) || !id(value.id) || !text(value.title) || !text(value.clipPath) || !object(value.platforms)
    || !optionalText(value.accountId) || !optionalText(value.caption)) return false;
  return Object.entries(value.platforms).every(([platform, state]) => PLATFORMS.includes(platform as PlatformId) && object(state)
    && ["pending", "uploaded", "scheduled", "published", "failed", "manual"].includes(String(state.status))
    && finite(state.attempts) && Number.isInteger(state.attempts));
}
function validExport(value: unknown): boolean {
  return object(value) && id(value.id) && id(value.jobId) && ["processing", "done", "error", "canceled"].includes(String(value.status)) && optionalText(value.file);
}
function validSource(value: unknown, sourceId: string): value is SourceMeta {
  return object(value) && value.id === sourceId && text(value.fileName) && text(value.storedName)
    && finite(value.durationSec) && finite(value.width) && finite(value.height);
}

async function seam(store: ExistingStoreReport["store"], read: () => unknown | Promise<unknown>): Promise<Result<unknown>> {
  try { return { report: { store, state: "loaded" }, value: structuredClone(await read()) }; }
  catch { return { report: { store, state: "unavailable", reason: "unreadable" } }; }
}
function filename(value: unknown): value is string {
  return text(value) && value.length <= 255 && !/[\\/:\u0000-\u001f\u007f]/.test(value) && value !== "." && value !== ".." && Boolean(allowedMediaType(value));
}

type MediaEntry = { grant: ProtectedMediaGrant; ref: ExistingMediaReference; jobId?: string; fileName?: string };
function empty(): ExistingRecordsWorkspace {
  return { connection: { state: "unavailable", message: "No authenticated server record scope is configured. No existing records were read." }, snapshot: "persisted_records", truncated: false, stores: [], sources: [], runs: [], clipJobs: [], clips: [], outputs: [], exports: [], schedules: [] };
}

/**
 * Passive adapter over the ORIGINAL stores. It does not import their lifecycle
 * modules at runtime: those readers migrate/recover/advance or initialize maps.
 * Missing files are explicitly reported, never created. No old row is enrolled
 * by owner inference, source linkage, account guesses, or request parameters.
 */
export function createExistingRecordReader(config: ExistingRecordReaderConfig) {
  async function snapshot(ownerId: string): Promise<{ workspace: ExistingRecordsWorkspace; media: Map<string, MediaEntry> }> {
    const workspace = empty();
    const media = new Map<string, MediaEntry>();
    if (!ownerId.trim() || ownerId.length > 128 || /[\u0000-\u001f\u007f]/.test(ownerId)) return { workspace, media };
    let scope: TrustedExistingRecordScope | null;
    try { scope = structuredClone(await config.resolveScope(ownerId)); } catch { return { workspace, media }; }
    if (!validScope(scope, ownerId)) return { workspace, media };
    workspace.connection = { state: "read_only", message: "Saved records only. Processing and publication state are reported by the original stores, without live platform verification." };
    const permitted = (ids: readonly string[], value: unknown): value is string => id(value) && ids.includes(value);
    const relatedSource = (value: unknown) => permitted(scope.sourceIds, value) ? value : undefined;
    const relatedJob = (value: unknown) => permitted(scope.clipJobIds, value) ? value : undefined;
    function addMedia(mediaId: string, relativePath: string, sourceType: ExistingMediaSource, jobId?: string, fileName?: string): ExistingMediaReference | undefined {
      const type = allowedMediaType(relativePath);
      if (media.size >= MAX_OUTPUTS) { workspace.truncated = true; return undefined; }
      if (!type || !isContainedMediaPath(dataRoot(), path.resolve(dataRoot(), relativePath))) return undefined;
      const ref = { id: mediaId, sourceType, contentType: type };
      media.set(mediaId, { ref, grant: { dataRoot: dataRoot(), relativePath, sourceType }, jobId, fileName });
      return ref;
    }
    const [runs, jobs, queue, exports, sources] = await Promise.all([
      scope.runIds.length ? readJson("runs", ["pipeline", "runs.json"]).then((result) => arrayResult<PipelineRun>(result, validRun)) : missing("runs"),
      scope.clipJobIds.length ? readJson("clip_jobs", ["clips", "jobs.json"]).then((result) => arrayResult<ClipJob>(result, validJob)) : missing("clip_jobs"),
      scope.queueIds.length && Object.values(scope.accountIds).some((accounts) => accounts && accounts.length) ? (config.readQueueSnapshot ? seam("queue", config.readQueueSnapshot)
        : process.env.PUBLISH_QUEUE_BACKEND === "r2" ? Promise.resolve(missing("queue", "not_configured"))
        : readJson("queue", ["publish-queue.json"])).then((result) => arrayResult<QueueItem>(result, validQueue)) : missing("queue"),
      scope.exportIds?.length ? (config.readClipExports ? seam("clip_exports", config.readClipExports).then((result) => arrayResult<ExportRecord>(result, validExport))
        : missing("clip_exports", "not_configured")) : missing("clip_exports"),
      Promise.all(scope.sourceIds.map(async (sourceId) => {
        const result = await readJson("sources", ["clips", "sources", sourceId, "meta.json"]);
        result.report.recordId = sourceId;
        if (result.report.state === "loaded" && !validSource(result.value, sourceId)) result.report = { ...result.report, state: "unavailable", reason: "malformed" };
        return result;
      }))
    ]);
    workspace.stores = [runs.report, jobs.report, queue.report, exports.report, ...sources.map((source) => source.report)];
    if (!scope.sourceIds.length) workspace.stores.push(missing("sources").report);
    for (const source of sources) {
      if (source.report.state !== "loaded") continue;
      const meta = source.value as SourceMeta;
      workspace.sources.push({ id: meta.id, title: existingDisplayText(meta.fileName, 240) ?? "Source recording", durationSec: meta.durationSec, width: meta.width, height: meta.height,
        media: filename(meta.storedName) ? addMedia(`source:${meta.id}`, path.join("clips", "sources", meta.id, meta.storedName), "source") : undefined });
    }
    for (const run of runs.value ?? []) {
      if (!scope.runIds.includes(run.id) || (run.marketingSource && (run.marketingSource.ownerId !== ownerId || run.marketingSource.archivedAt))) continue;
      const existingSource = workspace.sources.find((entry) => entry.id === relatedSource(run.sourceId));
      if (existingSource) existingSource.sourceUrl = sourceUrl(run.sourceUrl);
      workspace.runs.push({ id: run.id, title: existingDisplayText(run.name, 240) ?? "Pipeline run", status: run.status,
        sourceId: relatedSource(run.sourceId), clipJobId: relatedJob(run.clipJobId), progress: percent(run.progress), createdAt: date(run.createdAt), updatedAt: date(run.updatedAt),
        ...(run.error ? { error: "The original run reports an error. Check the local run for details." } : {}) });
    }
    for (const job of jobs.value ?? []) {
      if (!scope.clipJobIds.includes(job.id)) continue;
      const sourceId = relatedSource(job.sourceId);
      workspace.clipJobs.push({ id: job.id, title: existingDisplayText(job.fileName, 240) ?? "Clip job", sourceId, status: job.status, stage: job.stage,
        progress: percent(job.progress), createdAt: date(job.createdAt), ...(job.error ? { error: "The original clip job reports an error. Check the local job for details." } : {}) });
      for (const clip of job.clips) {
        if (workspace.clips.length >= MAX_OUTPUTS) { workspace.truncated = true; break; }
        const outputIds: string[] = [];
        const fields: [keyof ClipCandidate, ExistingMediaSource][] = [["file", "clip_master"], ["previewFile", "clip_preview"], ["downloadFile", "clip_ready"], ["editedFile", "clip_edited"], ["posterFile", "clip_poster"]];
        for (const [field, kind] of fields) {
          const file = clip[field];
          if (!filename(file)) continue;
          const outputId = `clip:${job.id}:${clip.id}:${kind}`;
          const ref = addMedia(outputId, path.join("clips", "outputs", job.id, file), kind, job.id, file);
          if (!ref) continue;
          workspace.outputs.push({ id: outputId, jobId: job.id, clipId: clip.id, kind, status: "reported_available", media: ref });
          outputIds.push(outputId);
          if (kind === "clip_edited") workspace.exports.push({ id: `edited:${job.id}:${clip.id}`, jobId: job.id, clipId: clip.id, status: "reported_done", createdAt: date(clip.editedAt), media: ref });
        }
        workspace.clips.push({ id: clip.id, jobId: job.id, sourceId, title: existingDisplayText(clip.title, 240) ?? `Clip ${workspace.clips.length + 1}`, start: clip.start, end: clip.end,
          status: filename(clip.editedFile) || filename(clip.downloadFile) ? "reported_ready" : filename(clip.previewFile) || filename(clip.file) ? "reported_preview" : "not_rendered", outputIds });
      }
    }
    for (const record of exports.value ?? []) {
      if (!scope.exportIds?.includes(record.id) || !scope.clipJobIds.includes(record.jobId) || !workspace.clipJobs.some((job) => job.id === record.jobId)) continue;
      const file = record.file;
      workspace.exports.push({ id: record.id, jobId: record.jobId, status: record.status, progress: percent(record.progress), createdAt: date(record.createdAt),
        media: record.status === "done" && filename(file) ? addMedia(`export:${record.id}`, path.join("clips", "outputs", record.jobId, file), "clip_export", record.jobId, file) : undefined,
        ...(record.error ? { error: "The original export reports an error. Check the local export for details." } : {}) });
    }
    for (const item of queue.value ?? []) {
      if (!scope.queueIds.includes(item.id) || (item.marketing && (item.marketing.ownerId !== ownerId || item.marketing.deletedAt))) continue;
      for (const platform of PLATFORMS) {
        const state = item.platforms[platform];
        const accountId = item.accountId ?? `${platform}-primary`;
        if (!state || !scope.accountIds[platform]?.includes(accountId)) continue;
        const uncertain = state.status !== "published" && (hasDeliveryEvidence(state) || hasBufferDeliveryEvidence(item.buffer));
        let ref: ExistingMediaReference | undefined;
        // Only media in the original generated-output folders can back queue refs.
        // Paths in old rows may be project-relative, but are never client input.
        const absolute = path.resolve(process.cwd(), item.clipPath);
        const relative = path.relative(dataRoot(), absolute);
        if ([dataPath("clips", "outputs"), dataPath("longform", "outputs"), dataPath("carousels"), dataPath("carousel-decks")].some((root) => isContainedMediaPath(root, absolute))) {
          ref = addMedia(`queue:${item.id}:${platform}`, relative, "scheduled_media");
        }
        workspace.schedules.push({ id: `${item.id}:${platform}`, queueId: item.id, jobId: relatedJob(item.jobId), runId: permitted(scope.runIds, item.runId) ? item.runId : undefined,
          title: existingDisplayText(item.title, 240) ?? "Scheduled output", caption: existingDisplayText(item.caption), platform, accountId, scheduledAt: date(item.publishAt), reportedStatus: state.status,
          status: uncertain ? "reconciliation_required" : state.status === "published" ? "reported_published" : state.status, publishedUrlVerified: false, media: ref,
          ...(uncertain || state.error ? { error: uncertain ? "The ledger reports delivery may have started. Live publication has not been verified." : "The original publisher reports an error. Check the local item for details." } : {}) });
        // A posting caption belongs to this clip only when both its scoped job
        // and its exact stored output file match. Names/titles never join records.
        if (ref && item.jobId) {
          const output = workspace.outputs.find((entry) => entry.jobId === item.jobId && media.get(entry.media.id)?.grant.relativePath === relative);
          const candidate = output && workspace.clips.find((entry) => entry.jobId === output.jobId && entry.id === output.clipId);
          if (candidate && !candidate.caption) candidate.caption = existingDisplayText(item.caption);
        }
      }
    }
    return { workspace, media };
  }
  return {
    async read(authenticatedOwnerId: string): Promise<ExistingRecordsWorkspace> { return (await snapshot(authenticatedOwnerId)).workspace; },
    async resolveMedia(authenticatedOwnerId: string, mediaId: string): Promise<ProtectedMediaGrant | null> {
      return (await snapshot(authenticatedOwnerId)).media.get(mediaId)?.grant ?? null;
    },
    /** Match editor descriptors to ACTUAL scoped candidate/export entries only. */
    async mediaId(authenticatedOwnerId: string, descriptor: { jobId: string; fileName: string }): Promise<string | null> {
      if (!object(descriptor) || !id(descriptor.jobId) || !filename(descriptor.fileName)) return null;
      return [...(await snapshot(authenticatedOwnerId)).media.values()].find((entry) => entry.jobId === descriptor.jobId && entry.fileName === descriptor.fileName)?.ref.id ?? null;
    }
  };
}
