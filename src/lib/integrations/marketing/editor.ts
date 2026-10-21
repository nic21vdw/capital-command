import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "@/lib/paths";
import { clipProjectSchema, captionSegmentSchema } from "@/lib/storage/schemas";
import { readExistingAppData, mutateExistingClipProject } from "@/lib/storage/store";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { AppData, ClipProject } from "@/types/domain";
import type { Principal } from "./safety";
import { ManagedEditorDeletedError, canonicalEditorJson, currentEditorState, editorDigest, editorProjectDigest, editorRenderSignature,
  invalidateEditorExportIntent } from "./editor-state";
import { editorTargetSchema, type EditorBinding, type EditorCommandResult, type EditorExportIntent,
  type EditorRecordBinding, type EditorReceipt, type EditorSnapshot, type EditorTarget,
  type MarketingEditorState, type RequestEditorExportCommand, type SaveEditorCommand, type DeleteEditorCommand,
  type EditorProjectSummary, type EditorOverlayAssetIdentity, editorMusicAssetIdentitySchema,
  type EditorMusicAssetIdentity, type CancelEditorExportCommand,
  type ReconcileEditorExportCommand, type SettleEditorExportCancellationCommand } from "./editor-types";
import type { createStoredEditorOverlayResolver, StoredEditorOverlayAsset } from "./editor-overlay-assets";
import type { createStoredEditorMusicResolver, StoredEditorMusicAsset } from "./editor-audio-assets";
export * from "./editor-types";

const commandFields = { commandId: z.string().uuid(), target: editorTargetSchema };
// Use the exact original project parser/defaults. Captions must be the complete
// explicitly loaded array; a stripped library copy is never an editor save.
export const saveEditorCommandSchema = z.object({
  operation: z.literal("save_editor_project"), ...commandFields,
  project: clipProjectSchema.omit({ marketingEditor: true }).extend({
    captions: z.array(captionSegmentSchema).max(20_000)
  }).strict()
}).strict();
export const requestEditorExportCommandSchema = z.object({ operation: z.literal("request_editor_export"), ...commandFields,
  supersedesRequestId: z.string().uuid().optional() }).strict();
export const deleteEditorCommandSchema = z.object({ operation: z.literal("delete_editor_project"), ...commandFields }).strict();
const exportAttemptFields = { ...commandFields, requestId: z.string().uuid(), attemptId: z.string().uuid().optional() };
export const cancelEditorExportCommandSchema = z.object({ operation: z.literal("cancel_editor_export"), ...exportAttemptFields }).strict();
export const reconcileEditorExportCommandSchema = z.object({ operation: z.literal("reconcile_editor_export"), ...exportAttemptFields }).strict();
export const settleEditorExportCancellationCommandSchema = z.object({ operation: z.literal("settle_editor_export_cancellation"),
  ...exportAttemptFields, attemptId: z.string().uuid(), cancelCommandId: z.string().uuid() }).strict();
export const claimEditorExportCommandSchema = z.object({
  operation: z.literal("claim_editor_export"), ...commandFields, requestId: z.string().uuid()
}).strict();
export const recordEditorExportOutcomeSchema = z.object({
  operation: z.literal("record_editor_export_outcome"), ...commandFields,
  requestId: z.string().uuid(), attemptId: z.string().uuid(),
  outcome: z.enum(["prepared", "failed_before_dispatch", "uncertain"])
}).strict();
export const editorCommandSchema = z.discriminatedUnion("operation", [saveEditorCommandSchema, deleteEditorCommandSchema,
  requestEditorExportCommandSchema, cancelEditorExportCommandSchema, reconcileEditorExportCommandSchema]);
export type ClaimEditorExportCommand = z.infer<typeof claimEditorExportCommandSchema>;
export type RecordEditorExportOutcomeCommand = z.infer<typeof recordEditorExportOutcomeSchema>;
export type AnyEditorCommand = SaveEditorCommand | DeleteEditorCommand | RequestEditorExportCommand | ClaimEditorExportCommand
  | RecordEditorExportOutcomeCommand | CancelEditorExportCommand | ReconcileEditorExportCommand | SettleEditorExportCancellationCommand;
type AnyCommand = AnyEditorCommand;

export class MarketingEditorError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable", message: string) {
    super(message); this.name = "MarketingEditorError";
  }
}
const fail = (code: MarketingEditorError["code"], message: string): never => { throw new MarketingEditorError(code, message); };
export type EditorStore = {
  read(): Promise<AppData | null>;
  mutate(id: string, update: (project: ClipProject) => ClipProject): Promise<ClipProject>;
  readJob(jobId: string): Promise<ClipJob | undefined>;
};
export type EditorPreparationEvidence = {
  requestId: string; attemptId: string; digest: string; renderSignature: string;
  exportId: string; artifactSha256: string;
  overlayAssets?: EditorOverlayAssetIdentity[];
  musicAsset?: EditorMusicAssetIdentity;
  /** Recheck the trusted artifact identity immediately before locked commit. */
  assertCurrent(): void;
};
export type EditorAttemptInspection = {
  workerEpoch: string;
  status: "active" | "settled" | "missing" | "prior_epoch";
  /** Recheck the exact registry identity/status, including absence, inside CAS. */
  assertCurrent(): void;
};
export type EditorCancellationSettlement = {
  requestId: string; attemptId: string; workerEpoch: string; cancelCommandId: string; settled: true;
  /** Exact fence observed before abort and full matching preparation callback settled. */
  assertCurrent(): void;
};
export type EditorWorkerPorts = {
  /** Trusted owner-process guard: renderer must have no enqueue/send side effect. */
  assertPreparationOnly(): void;
  readPreparation(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<EditorPreparationEvidence | null>;
  verifyFailureBeforeDispatch?(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<boolean>;
  getWorkerEpoch?(): string;
  inspectAttempt?(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<EditorAttemptInspection>;
  readCancellationSettlement?(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<EditorCancellationSettlement | null>;
};

/** Reads cached source captions only. Importing jobs.ts would initialize a mutable worker cache. */
export async function readOriginalEditorJob(jobId: string): Promise<ClipJob | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(dataPath("clips", "jobs.json"), "utf8"));
    if (!Array.isArray(parsed)) return fail("unavailable", "The existing clip records could not be read.");
    const matches = parsed.filter((job) => job && typeof job === "object" && job.id === jobId);
    if (matches.length > 1) return fail("conflict", "Duplicate original clip records require reconciliation.");
    return matches[0] as ClipJob | undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof MarketingEditorError) throw error;
    return fail("unavailable", "The existing clip records could not be read.");
  }
}
const originalStore: EditorStore = { read: readExistingAppData, mutate: mutateExistingClipProject, readJob: readOriginalEditorJob };
const safeId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);
type VerifiedEditorAssets = { overlays: readonly StoredEditorOverlayAsset[]; music: StoredEditorMusicAsset | null };
export const isEditorMediaFileName = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 255 && !value.startsWith(".") && !/[\\/:\u0000-\u001f\u007f]/.test(value);
const storedImageRef = (value: string | undefined): boolean => Boolean(value
  && /^\/api\/clips\/overlay-images\/[a-f0-9]{40}\.(?:png|jpg|webp)$/.test(value));
function publicProject(project: ClipProject): ClipProject {
  const { marketingEditor: _private, ...original } = structuredClone(project);
  void _private;
  return { ...original, sourceUrl: "", posterFile: isEditorMediaFileName(original.posterFile) ? original.posterFile : undefined,
    audio: { ...original.audio, musicSrc: undefined,
      musicName: original.audio.musicName && !/[\\/:]/.test(original.audio.musicName) ? original.audio.musicName : undefined },
    exportSettings: { ...original.exportSettings,
      filename: isEditorMediaFileName(original.exportSettings.filename) ? original.exportSettings.filename : "clip" },
    overlays: original.overlays.map((overlay) => ({ ...overlay, src: undefined })),
    renderSignature: editorRenderSignature(project), captionCount: project.captions.length };
}
const equal = (a: unknown, b: unknown): boolean => canonicalEditorJson(a) === canonicalEditorJson(b);
const sameTarget = (a: EditorTarget, b: EditorTarget): boolean => equal(a, b);
const receiptOnly = (operation: AnyCommand["operation"]): boolean => ["cancel_editor_export", "reconcile_editor_export", "settle_editor_export_cancellation"].includes(operation);
const workerOperation = (operation: AnyCommand["operation"]): boolean => ["claim_editor_export", "record_editor_export_outcome", "settle_editor_export_cancellation"].includes(operation);
function exactIntent(state: MarketingEditorState, requestId: string, attemptId?: string): EditorExportIntent {
  const intents = state.exports.filter((intent) => intent.requestId === requestId);
  if (intents.length !== 1 || intents[0].attemptId !== attemptId) return fail("conflict", "The original export request or attempt changed.");
  return intents[0];
}
function stateTarget(project: ClipProject, binding: EditorRecordBinding, state: MarketingEditorState): EditorTarget {
  return { projectId: project.id, jobId: binding.jobId, clipId: binding.clipId,
    revision: state.revision, digest: state.digest, renderSignature: state.renderSignature };
}
function validateEdit(project: ClipProject, stored: ClipProject): ClipProject {
  const visible = publicProject(stored);
  const immutable = ["id", "jobId", "sourceFile", "posterFile", "sourceUrl", "baseDurationSec", "baseWidth", "baseHeight",
    "clipStart", "clipEnd", "createdAt"] as const;
  if (immutable.some((key) => !equal(project[key], visible[key]))) fail("conflict", "The original project or media identity changed.");
  if (canonicalEditorJson(project).length > 4_000_000) fail("invalid", "The editor project is too large.");
  const base = stored.baseDurationSec;
  if (!(base > 0) || project.trimStart >= (project.trimEnd || base) || (project.trimEnd || base) > base
    || project.trimStart > base) fail("invalid", "Choose trim points within the original clip.");
  const ranges = [...project.captions, ...(project.segments ?? []), ...project.overlays];
  if (ranges.some((range) => range.end < range.start || range.end > base + 0.001 || range.start > base)) {
    fail("invalid", "Caption and edit ranges must fit within the original clip.");
  }
  if (project.captions.some((caption) => caption.words.some((word) => word.end < word.start || word.end > base + 0.001))) {
    fail("invalid", "Caption word timing must fit within the original clip.");
  }
  if (new Set(project.captions.map((caption) => caption.id)).size !== project.captions.length
    || new Set(project.overlays.map((overlay) => overlay.id)).size !== project.overlays.length) fail("invalid", "Editor row IDs must be unique.");
  if (!isEditorMediaFileName(project.exportSettings.filename)) fail("invalid", "Use a filename without folders.");
  // Asset selection/upload is outside this port. Preserve the original internal
  // references (including redacted legacy references), never accept caller paths.
  if (project.audio.musicSrc !== visible.audio.musicSrc) fail("invalid", "Music assets require the original asset selector.");
  const overlays = project.overlays.map((overlay) => {
    const prior = stored.overlays.find((candidate) => candidate.id === overlay.id);
    if (overlay.src !== undefined) fail("invalid", "Image assets require the original asset selector.");
    if (!prior && overlay.kind !== "text") fail("invalid", "New image assets require the original asset selector.");
    if (prior && prior.kind !== overlay.kind) fail("invalid", "An existing overlay's kind cannot be substituted.");
    return { ...overlay, src: prior?.src };
  });
  return { ...project, sourceUrl: stored.sourceUrl, posterFile: stored.posterFile, overlays,
    audio: { ...project.audio, musicSrc: stored.audio.musicSrc, musicName: stored.audio.musicName },
    marketingEditor: undefined, captionsOmitted: undefined, updatedAt: new Date().toISOString() };
}

/** No constructor enrollment, network fetch, caption generation, render or publication. */
export class MarketingEditor {
  private readonly binding: EditorBinding;
  private readonly store: EditorStore;
  private readonly worker?: EditorWorkerPorts;
  private readonly overlayAssets?: Pick<ReturnType<typeof createStoredEditorOverlayResolver>, "resolveMany">;
  private readonly musicAssets?: Pick<ReturnType<typeof createStoredEditorMusicResolver>, "resolve">;
  constructor(options: { binding: EditorBinding; store?: EditorStore; worker?: EditorWorkerPorts;
    overlayAssets?: Pick<ReturnType<typeof createStoredEditorOverlayResolver>, "resolveMany">;
    musicAssets?: Pick<ReturnType<typeof createStoredEditorMusicResolver>, "resolve"> }) {
    this.binding = structuredClone(options.binding);
    this.store = options.store ?? originalStore;
    this.worker = options.worker;
    this.overlayAssets = options.overlayAssets;
    this.musicAssets = options.musicAssets;
    if (!this.binding.ownerId?.trim() || this.binding.ownerId.length > 128) fail("invalid", "An explicit owner binding is required.");
    const records = this.binding.records;
    if (!Array.isArray(records) || records.some((row) => ![row.projectId, row.jobId, row.clipId].every(safeId)
      || !isEditorMediaFileName(row.sourceFile)) || new Set(records.map((row) => row.projectId)).size !== records.length) {
      fail("invalid", "An explicit original-record allowlist is required.");
    }
  }
  private authorize(principal: Principal, projectId: string, scope: "read" | "write" | "worker"): EditorRecordBinding {
    if (principal.ownerId !== this.binding.ownerId || !principal.scopes.includes(scope)) fail("forbidden", "This editor operation is outside the verified owner scope.");
    const record = this.binding.records.find((row) => row.projectId === projectId);
    if (!record) return fail("forbidden", "This original editor record is outside the explicit allowlist.");
    return record;
  }
  private state(project: ClipProject, record: EditorRecordBinding): MarketingEditorState {
    if (project.id !== record.projectId || project.jobId !== record.jobId || project.sourceFile !== record.sourceFile) fail("conflict", "The original project or media identity changed.");
    const existing = project.marketingEditor;
    if (existing && (existing.ownerId !== this.binding.ownerId || existing.jobId !== record.jobId || existing.clipId !== record.clipId)) fail("forbidden", "The original editor record belongs to a different binding.");
    if (existing?.deletedAt) fail("not_found", "The original editor project was deleted.");
    return existing ? currentEditorState(project, existing) : {
      ownerId: this.binding.ownerId, jobId: record.jobId, clipId: record.clipId,
      revision: 0, digest: editorProjectDigest(project), renderSignature: editorRenderSignature(project), receipts: [], exports: []
    };
  }
  private async original(record: EditorRecordBinding): Promise<{ job: ClipJob; clip: ClipCandidate }> {
    const job = await this.store.readJob(record.jobId);
    if (!job || job.id !== record.jobId || !Array.isArray(job.clips)) return fail("not_found", "The original clip record was not found.");
    const matches = job.clips.filter((clip) => clip.id === record.clipId && (
      clip.file === record.sourceFile || (Array.isArray(clip.variants) && clip.variants.some((variant) => variant.file === record.sourceFile))
    ));
    if (matches.length !== 1) return fail("conflict", "The original clip and project no longer refer to the same media.");
    if (!Number.isFinite(matches[0].start) || !Number.isFinite(matches[0].end) || matches[0].start < 0 || matches[0].end <= matches[0].start) {
      return fail("conflict", "The original clip timing requires reconciliation.");
    }
    return { job, clip: matches[0] };
  }
  private async snapshot(project: ClipProject, record: EditorRecordBinding, job: ClipJob, clip: ClipCandidate, principal: Principal): Promise<EditorSnapshot> {
    if (Math.abs(project.clipStart - clip.start) > 0.001 || Math.abs(project.clipEnd - clip.end) > 0.001) {
      return fail("conflict", "The original clip boundaries no longer match this editor project.");
    }
    const state = this.state(project, record);
    const current = Boolean(clip.editedFile && clip.editedSignature === state.renderSignature);
    const captions = z.array(captionSegmentSchema).safeParse(job.sourceCaptions ?? []);
    const latest = state.exports.at(-1);
    const target = stateTarget(project, record, state);
    // Image bytes are verified by the protected composition. Keep this read
    // metadata-only so cached HEAD/ranges do not decode those files again.
    const imageRows = project.overlays.filter((row) => row.kind !== "text");
    let complete = !project.overlays.some((row) => row.kind === "text" ? Boolean(row.src) : !storedImageRef(row.src))
      && (!imageRows.length || Boolean(this.overlayAssets));
    let music: StoredEditorMusicAsset | null = null;
    if (complete) {
      try { music = await this.resolveMusic(target, project); } catch { complete = false; }
    }
    return {
      project: publicProject(project), target,
      cachedCaptions: { captions: captions.success ? captions.data : [],
        fetchedAt: typeof job.captionsFetchedAt === "string" && Number.isFinite(Date.parse(job.captionsFetchedAt)) ? job.captionsFetchedAt : null },
      media: { source: { jobId: record.jobId, fileName: record.sourceFile },
        ...(complete && imageRows.length ? { overlays: imageRows.map((row) => ({ overlayId: row.id })) } : {}),
        ...(complete && music ? { music: this.musicIdentity(music) } : {}),
        ...(isEditorMediaFileName(project.posterFile) ? { poster: { jobId: record.jobId, fileName: project.posterFile } } : {}),
        ...(isEditorMediaFileName(clip.editedFile) ? { edited: { jobId: record.jobId, fileName: clip.editedFile,
          renderSignature: typeof clip.editedSignature === "string" && /^[a-z0-9]{1,64}$/.test(clip.editedSignature) ? clip.editedSignature : undefined, current } } : {}) },
      export: latest ? { state: latest.state, requestId: latest.requestId,
        ...(latest.attemptId ? { attemptId: latest.attemptId } : {}) } : { state: "not_requested" },
      requiresAssetConnection: !complete,
      capabilities: { save: complete && principal.scopes.includes("write"), deleteProject: principal.scopes.includes("write"),
        requestExport: complete && principal.scopes.includes("write"), dispatchExport: false },
      reviewRequired: true, publicationAuthorized: false
    };
  }
  async list(principal: Principal): Promise<EditorProjectSummary[]> {
    if (principal.ownerId !== this.binding.ownerId || !principal.scopes.includes("read")) fail("forbidden", "This editor operation is outside the verified owner scope.");
    if (!this.binding.records.length) return [];
    const data = await this.store.read();
    return (data?.clipProjects ?? []).flatMap((project) => {
      const record = this.binding.records.find((row) => row.projectId === project.id);
      if (!record || project.marketingEditor?.deletedAt) return [];
      if (data!.clipProjects.filter((candidate) => candidate.id === project.id).length !== 1) fail("conflict", "The original editor project is not unique.");
      const state = this.state(project, record);
      return [{ id: project.id, name: project.name, updatedAt: project.updatedAt, jobId: project.jobId, durationSec: project.baseDurationSec,
        deleteTarget: stateTarget(project, record, state), canDelete: principal.scopes.includes("write") }];
    });
  }
  /** Exact owner/revision preflight for already verified prepared media; no asset decode. */
  async readPreparedTarget(principal: Principal, projectId: string, requestId: string): Promise<EditorTarget> {
    const record = this.authorize(principal, projectId, "read");
    const data = await this.store.read();
    const matches = data?.clipProjects.filter((project) => project.id === projectId) ?? [];
    if (matches.length !== 1) return fail("not_found", "The original editor project was not found.");
    const state = this.state(matches[0], record);
    const latest = state.exports.at(-1);
    if (latest?.state !== "prepared" || latest.requestId !== requestId) return fail("not_found", "This is not the current prepared editor export.");
    return stateTarget(matches[0], record, state);
  }
  async load(principal: Principal, projectId: string): Promise<EditorSnapshot> {
    const record = this.authorize(principal, projectId, "read");
    const data = await this.store.read();
    const matches = data?.clipProjects.filter((project) => project.id === projectId) ?? [];
    if (matches.length !== 1) return fail("not_found", "The original editor project was not found.");
    this.state(matches[0], record);
    const { job, clip } = await this.original(record);
    return this.snapshot(matches[0], record, job, clip, principal);
  }
  private parsed<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) return fail("invalid", "The editor command is invalid or incomplete.");
    return result.data;
  }
  /**
   * Receipt lookup precedes live project/media preflight. A committed command
   * remains known after deletion or source loss, without recreating anything.
   * This is also the root HTTP composition's idempotency preflight seam.
   */
  async replay(principal: Principal, input: AnyEditorCommand): Promise<EditorCommandResult | null> {
    const schema = input?.operation === "save_editor_project" ? saveEditorCommandSchema
      : input?.operation === "delete_editor_project" ? deleteEditorCommandSchema
      : input?.operation === "request_editor_export" ? requestEditorExportCommandSchema
      : input?.operation === "claim_editor_export" ? claimEditorExportCommandSchema
      : input?.operation === "cancel_editor_export" ? cancelEditorExportCommandSchema
      : input?.operation === "reconcile_editor_export" ? reconcileEditorExportCommandSchema
      : input?.operation === "settle_editor_export_cancellation" ? settleEditorExportCancellationCommandSchema
      : input?.operation === "record_editor_export_outcome" ? recordEditorExportOutcomeSchema : null;
    if (!schema) return fail("invalid", "The editor command is invalid or incomplete.");
    const command = this.parsed(schema as z.ZodType<AnyEditorCommand>, input);
    const scope = workerOperation(command.operation) ? "worker" : "write";
    const record = this.authorize(principal, command.target.projectId, scope);
    const matches = (await this.store.read())?.clipProjects.filter((project) => project.id === record.projectId) ?? [];
    if (matches.length > 1) return fail("conflict", "The original editor receipt record is not unique.");
    const project = matches[0];
    const state = project?.marketingEditor;
    if (!state) return null;
    if (state.ownerId !== this.binding.ownerId || state.jobId !== record.jobId || state.clipId !== record.clipId) {
      return fail("forbidden", "The original editor receipt belongs to a different binding.");
    }
    const prior = state.receipts.find((entry) => entry.result.commandId === command.commandId);
    if (!prior) return null;
    if (prior.payloadSha256 !== editorDigest(command)) return fail("conflict", "The command UUID was already used for a different editor action.");
    if (receiptOnly(command.operation)) return { receipt: prior.result, replayed: true, snapshot: null, reconciliation: { state: "refresh_required" } };
    if (state.deletedAt) return { receipt: prior.result, replayed: true, snapshot: null, reconciliation: { state: "deleted" } };
    try {
      const { job, clip } = await this.original(record);
      return { receipt: prior.result, replayed: true, snapshot: await this.snapshot(project, record, job, clip, principal) };
    } catch {
      return { receipt: prior.result, replayed: true, snapshot: null, reconciliation: { state: "record_unavailable" } };
    }
  }
  private async transact(
    principal: Principal, command: AnyCommand, transition: (project: ClipProject, state: MarketingEditorState) => { project: ClipProject; state: MarketingEditorState; intent?: EditorExportIntent },
    scope: "write" | "worker" = "write", requireOriginalMedia = true
  ): Promise<EditorCommandResult> {
    const committed = await this.replay(principal, command);
    if (committed) return committed;
    const record = this.authorize(principal, command.target.projectId, scope);
    const original = requireOriginalMedia ? await this.original(record) : null;
    const payloadSha256 = editorDigest(command);
    let receipt!: EditorReceipt;
    let replayed = false;
    let saved: ClipProject;
    try { saved = await this.store.mutate(record.projectId, (project) => {
      const state = this.state(project, record);
      if (original && (Math.abs(project.clipStart - original.clip.start) > 0.001 || Math.abs(project.clipEnd - original.clip.end) > 0.001)) {
        return fail("conflict", "The original clip boundaries no longer match this editor project.");
      }
      const prior = state.receipts.find((entry) => entry.result.commandId === command.commandId);
      if (prior) {
        if (prior.payloadSha256 !== payloadSha256) return fail("conflict", "The command UUID was already used for a different editor action.");
        receipt = prior.result; replayed = true; return { ...project, marketingEditor: state };
      }
      if (!sameTarget(command.target, stateTarget(project, record, state))) return fail("conflict", "The editor revision or content changed. Load the current original project.");
      if (state.receipts.length >= 1024) return fail("unavailable", "The editor command history is full and requires reconciliation.");
      const next = transition(project, state);
      receipt = { commandId: command.commandId, operation: command.operation,
        revision: next.state.revision, digest: next.state.digest, renderSignature: next.state.renderSignature,
        ...(next.intent ? { requestId: next.intent.requestId, state: next.intent.state,
          ...(next.intent.attemptId ? { attemptId: next.intent.attemptId } : {}),
          ...(next.intent.cancellation ? { cancelCommandId: next.intent.cancellation.commandId } : {}) } : {}),
        reviewInvalidated: true, publicationAuthorized: false };
      next.state.receipts.push({ payloadSha256, result: receipt });
      return { ...next.project, marketingEditor: next.state, renderSignature: next.state.renderSignature, captionCount: next.project.captions.length };
    }); } catch (error) {
      // A concurrent delete can win after receipt preflight. A known receipt
      // still replays; a new command must not resurrect the tombstone.
      if (!(error instanceof ManagedEditorDeletedError)) throw error;
      const replay = await this.replay(principal, command);
      if (replay) return replay;
      return fail("not_found", "The original editor project was deleted.");
    }
    if (receiptOnly(command.operation)) return { receipt, replayed, snapshot: null, reconciliation: { state: "refresh_required" } };
    if (saved.marketingEditor?.deletedAt) return { receipt, replayed, snapshot: null, reconciliation: { state: "deleted" } };
    // The response uses the same original source cache read before mutation;
    // publication readiness still requires independent current-byte proof.
    if (!original) return fail("unavailable", "The editor command did not reach its expected terminal state.");
    return { receipt, replayed, snapshot: await this.snapshot(saved, record, original.job, original.clip, principal) };
  }
  async save(principal: Principal, input: SaveEditorCommand): Promise<EditorCommandResult> {
    const command = this.parsed(saveEditorCommandSchema, input) as SaveEditorCommand;
    this.authorize(principal, command.target.projectId, "write");
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const assets = await this.resolveAssets(command.target);
    return this.transact(principal, command, (project, state) => {
      this.assertAssetsCurrent(assets, project);
      const edited = validateEdit(command.project, project);
      const next = currentEditorState(edited, state);
      // Even a no-op save is an explicit new review boundary. Requesting an
      // export alone does not change the project revision.
      if (next.revision === state.revision) {
        if (next.revision >= Number.MAX_SAFE_INTEGER) return fail("unavailable", "The editor revision requires reconciliation.");
        next.revision += 1;
        next.exports = next.exports.map(invalidateEditorExportIntent);
      }
      return { project: edited, state: next };
    });
  }
  async requestExport(principal: Principal, input: RequestEditorExportCommand): Promise<EditorCommandResult> {
    const command = this.parsed(requestEditorExportCommandSchema, input);
    this.authorize(principal, command.target.projectId, "write");
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const superseded = command.supersedesRequestId ? await this.readIntent(principal, command.target, command.supersedesRequestId, "write") : null;
    if (superseded && (superseded.intent.state !== "uncertain" || !superseded.intent.reconciliation || superseded.intent.supersededByRequestId)) {
      return fail("conflict", "Only one explicitly reconciled uncertain request can be superseded.");
    }
    const inspection = superseded ? await this.inspect(superseded.project, superseded.intent) : null;
    if (superseded && !inspection) return fail("unavailable", "A trusted current worker inspection is required before an explicit restart request.");
    if (inspection?.status === "active") return fail("conflict", "The previous attempt is still owned by an active worker.");
    const assets = await this.exportAssets(command.target);
    return this.transact(principal, command, (project, state) => {
      if (superseded) {
        const previous = exactIntent(state, superseded.intent.requestId, superseded.intent.attemptId);
        if (!equal(previous, superseded.intent) || previous.state !== "uncertain" || !previous.reconciliation || previous.supersededByRequestId) {
          return fail("conflict", "The previous reconciled export request changed.");
        }
        inspection!.assertCurrent();
      }
      if (state.exports.some((intent) => ["pending_dispatch", "claimed", "cancel_requested", "uncertain"].includes(intent.state)
        && !intent.supersededByRequestId && intent.requestId !== command.supersedesRequestId)) fail("conflict", "An export is pending, claimed, or uncertain and must be reconciled before another request.");
      if (state.exports.length >= 256) fail("unavailable", "The editor export history is full and requires reconciliation.");
      const intent: EditorExportIntent = { requestId: command.commandId, revision: state.revision,
        digest: state.digest, renderSignature: state.renderSignature, state: "pending_dispatch",
        ...(command.supersedesRequestId ? { supersedesRequestId: command.supersedesRequestId } : {}),
        ...(assets.overlays.length ? { overlayAssets: this.assetIdentities(assets.overlays) } : {}),
        ...(assets.music ? { musicAsset: this.musicIdentity(assets.music) } : {}) };
      this.assertAssetsCurrent(assets, project);
      if (superseded) exactIntent(state, superseded.intent.requestId, superseded.intent.attemptId).supersededByRequestId = intent.requestId;
      state.exports.push(intent);
      return { project, state, intent };
    });
  }
  /** Delete the project only; source media and running worker processes are separate. */
  async deleteProject(principal: Principal, input: DeleteEditorCommand): Promise<EditorCommandResult> {
    const command = this.parsed(deleteEditorCommandSchema, input);
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const record = this.authorize(principal, command.target.projectId, "write");
    const matches = (await this.store.read())?.clipProjects.filter((project) => project.id === record.projectId) ?? [];
    if (!matches.length) return fail("not_found", "The original editor project was not found.");
    if (matches.length !== 1) return fail("conflict", "The original editor project is not unique.");
    this.state(matches[0], record);
    return this.transact(principal, command, (project, state) => {
      if (state.revision >= Number.MAX_SAFE_INTEGER) return fail("unavailable", "The editor revision requires reconciliation.");
      state.revision += 1;
      state.deletedAt = new Date().toISOString();
      state.exports = state.exports.map((intent) => ({ ...intent, state: "stale" }));
      return { project, state };
    }, "write", false);
  }
  /** Persist the fence only. The owner may invoke its exact abort port AFTER this returns. */
  async cancelExport(principal: Principal, input: CancelEditorExportCommand): Promise<EditorCommandResult> {
    const command = this.parsed(cancelEditorExportCommandSchema, input);
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const { intent } = await this.readIntent(principal, command.target, command.requestId, "write");
    if (intent.attemptId !== command.attemptId) return fail("conflict", "The original export attempt changed.");
    return this.transact(principal, command, (project, state) => {
      const active = exactIntent(state, command.requestId, command.attemptId);
      if (["prepared", "failed_before_dispatch", "canceled"].includes(active.state)) return { project, state, intent: active };
      if (!["pending_dispatch", "claimed", "cancel_requested"].includes(active.state)) return fail("conflict", "This export requires explicit reconciliation before cancellation.");
      if (active.state === "pending_dispatch" && active.attemptId) return fail("conflict", "The pending export already has an attempt.");
      if (active.state !== "pending_dispatch" && !active.attemptId) return fail("conflict", "The claimed export attempt is incomplete.");
      active.cancellation ??= { commandId: command.commandId, requestedAt: new Date().toISOString() };
      active.state = active.state === "pending_dispatch" ? "canceled" : "cancel_requested";
      return { project, state, intent: active };
    }, "write", false);
  }
  /** Explicit observation only: never starts, resumes, requeues or reuses an attempt. */
  async reconcileExport(principal: Principal, input: ReconcileEditorExportCommand): Promise<EditorCommandResult> {
    const command = this.parsed(reconcileEditorExportCommandSchema, input);
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const before = await this.readIntent(principal, command.target, command.requestId, "write");
    if (before.intent.attemptId !== command.attemptId) return fail("conflict", "The original export attempt changed.");
    const needsInspection = ["claimed", "cancel_requested", "uncertain"].includes(before.intent.state);
    const evidence = ["cancel_requested", "uncertain"].includes(before.intent.state) && before.intent.cancellation && !before.intent.supersededByRequestId
      ? await this.cancellationEvidence(before.project, before.intent) : null;
    const inspection = needsInspection && !evidence ? await this.inspect(before.project, before.intent) : null;
    return this.transact(principal, command, (project, state) => {
      const active = exactIntent(state, command.requestId, command.attemptId);
      if (!equal(active, before.intent)) return fail("conflict", "The export changed during explicit reconciliation.");
      if (needsInspection) {
        if (evidence) { evidence.assertCurrent(); active.state = "canceled"; }
        else if (inspection?.status !== "active") {
          inspection?.assertCurrent();
          active.state = "uncertain";
          active.reconciliation = { commandId: command.commandId, reconciledAt: new Date().toISOString(), reason: "unconfirmed_attempt" };
        } else inspection.assertCurrent();
      }
      return { project, state, intent: active };
    }, "write", false);
  }
  /** Worker-only: a client cannot supply a successful stop or an epoch. */
  async settleExportCancellation(principal: Principal, input: SettleEditorExportCancellationCommand): Promise<EditorCommandResult> {
    const command = this.parsed(settleEditorExportCancellationCommandSchema, input);
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    const before = await this.readIntent(principal, command.target, command.requestId, "worker");
    if (before.intent.attemptId !== command.attemptId || before.intent.cancellation?.commandId !== command.cancelCommandId) {
      return fail("conflict", "The persisted cancellation fence does not match this attempt.");
    }
    const maySettle = ["cancel_requested", "uncertain"].includes(before.intent.state) && !before.intent.supersededByRequestId;
    const evidence = maySettle ? await this.cancellationEvidence(before.project, before.intent) : null;
    const inspection = maySettle && !evidence ? await this.inspect(before.project, before.intent) : null;
    return this.transact(principal, command, (project, state) => {
      const active = exactIntent(state, command.requestId, command.attemptId);
      if (!equal(active, before.intent)) return fail("conflict", "The export cancellation changed before settlement.");
      if (maySettle) {
        if (evidence) { evidence.assertCurrent(); active.state = "canceled"; }
        else { inspection?.assertCurrent(); if (inspection?.status !== "active") active.state = "uncertain"; }
      }
      return { project, state, intent: active };
    }, "worker", false);
  }
  async claimExport(principal: Principal, input: ClaimEditorExportCommand): Promise<EditorCommandResult & { attemptId: string }> {
    const command = this.parsed(claimEditorExportCommandSchema, input);
    this.authorize(principal, command.target.projectId, "worker");
    const replay = await this.replay(principal, command);
    if (!replay && !this.worker) return fail("unavailable", "No preparation-only renderer is bound. The explicit export intent remains pending.");
    if (!replay) this.worker!.assertPreparationOnly();
    const workerEpoch = replay ? undefined : this.worker?.getWorkerEpoch?.();
    if (!replay && !z.string().uuid().safeParse(workerEpoch).success) return fail("unavailable", "A trusted owning-process epoch is required to claim this export.");
    const assets = replay ? null : await this.exportAssets(command.target);
    const result = replay ?? await this.transact(principal, command, (project, state) => {
      const intent = state.exports.find((candidate) => candidate.requestId === command.requestId);
      if (!intent || intent.state !== "pending_dispatch" || intent.digest !== state.digest || intent.revision !== state.revision) return fail("conflict", "The export request is not pending for this exact editor revision.");
      if (!equal(intent.overlayAssets ?? [], this.assetIdentities(assets!.overlays))
        || !equal(intent.musicAsset, assets!.music ? this.musicIdentity(assets!.music) : undefined)) return fail("conflict", "The requested asset bytes changed before this export was claimed.");
      if (this.worker!.getWorkerEpoch?.() !== workerEpoch) return fail("conflict", "The trusted worker epoch changed before its claim committed.");
      this.assertAssetsCurrent(assets!, project);
      intent.state = "claimed"; intent.attemptId = randomUUID(); intent.workerEpoch = workerEpoch;
      return { project, state, intent };
    }, "worker");
    const attemptId = result.receipt.attemptId ?? (await this.store.read())?.clipProjects
      .find((project) => project.id === command.target.projectId)?.marketingEditor?.exports
      .find((candidate) => candidate.requestId === command.requestId)?.attemptId;
    if (!attemptId) return fail("conflict", "The original claimed export attempt requires reconciliation.");
    return { ...result, attemptId };
  }
  async recordExportOutcome(principal: Principal, input: RecordEditorExportOutcomeCommand): Promise<EditorCommandResult> {
    const command = this.parsed(recordEditorExportOutcomeSchema, input);
    this.authorize(principal, command.target.projectId, "worker");
    const replay = await this.replay(principal, command);
    if (replay) return replay;
    if (!this.worker) return fail("unavailable", "No preparation-only renderer proof reader is bound.");
    this.worker.assertPreparationOnly();
    const assets = command.outcome === "prepared" ? await this.exportAssets(command.target) : null;
    const project = (await this.store.read())?.clipProjects.find((candidate) => candidate.id === command.target.projectId);
    const intent = project?.marketingEditor?.exports.find((candidate) => candidate.requestId === command.requestId);
    if (!project || !intent || intent.attemptId !== command.attemptId) return fail("conflict", "The original export attempt does not match.");
    const evidence = command.outcome === "prepared" ? await this.worker.readPreparation(project, intent) : null;
    const failureVerified = command.outcome === "failed_before_dispatch"
      ? await this.worker.verifyFailureBeforeDispatch?.(project, intent) : false;
    if (command.outcome === "prepared" && (!evidence || evidence.requestId !== intent.requestId || evidence.attemptId !== intent.attemptId
      || evidence.digest !== intent.digest || evidence.renderSignature !== intent.renderSignature
      || !equal(evidence.overlayAssets ?? [], intent.overlayAssets ?? [])
      || !equal(evidence.musicAsset, intent.musicAsset)
      || !equal(evidence.musicAsset, assets?.music ? this.musicIdentity(assets.music) : undefined)
      || !safeId(evidence.exportId) || !/^[a-f0-9]{64}$/.test(evidence.artifactSha256))) fail("conflict", "Independent preparation proof does not match this export attempt.");
    if (command.outcome === "failed_before_dispatch" && !failureVerified) fail("conflict", "The worker has not independently verified failure before dispatch.");
    return this.transact(principal, command, (current, state) => {
      const active = state.exports.find((candidate) => candidate.requestId === command.requestId);
      if (!active || active.state !== "claimed" || active.attemptId !== command.attemptId || active.digest !== state.digest
        || active.revision !== state.revision || (evidence && (!equal(active.overlayAssets ?? [], evidence.overlayAssets ?? [])
          || !equal(active.musicAsset, evidence.musicAsset)))) return fail("conflict", "The export attempt is stale or no longer claimed.");
      if (assets) this.assertAssetsCurrent(assets, current);
      evidence?.assertCurrent();
      active.state = command.outcome;
      if (evidence) { active.artifactSha256 = evidence.artifactSha256; active.exportId = evidence.exportId; }
      return { project: current, state, intent: active };
    }, "worker");
  }
  private async readIntent(principal: Principal, target: EditorTarget, requestId: string, scope: "write" | "worker") {
    const record = this.authorize(principal, target.projectId, scope);
    const matches = (await this.store.read())?.clipProjects.filter((project) => project.id === record.projectId) ?? [];
    if (!matches.length) return fail("not_found", "The original editor project was not found.");
    if (matches.length !== 1) return fail("conflict", "The original editor project is not unique.");
    const project = structuredClone(matches[0]);
    const state = this.state(project, record);
    if (!sameTarget(target, stateTarget(project, record, state))) return fail("conflict", "The editor revision or content changed.");
    const intents = state.exports.filter((intent) => intent.requestId === requestId);
    if (intents.length !== 1) return fail("conflict", "The original export request is missing or ambiguous.");
    return { project: { ...project, marketingEditor: state }, intent: intents[0] };
  }
  private async inspect(project: ClipProject, intent: EditorExportIntent): Promise<EditorAttemptInspection | null> {
    if (!this.worker?.inspectAttempt) return null;
    this.worker.assertPreparationOnly();
    const inspection = await this.worker.inspectAttempt(project, intent);
    if (!inspection || !z.string().uuid().safeParse(inspection.workerEpoch).success
      || inspection.workerEpoch !== this.worker.getWorkerEpoch?.() || typeof inspection.assertCurrent !== "function"
      || !["active", "settled", "missing", "prior_epoch"].includes(inspection.status)
      || (["active", "settled"].includes(inspection.status) && (!intent.attemptId || inspection.workerEpoch !== intent.workerEpoch))
      || (inspection.status === "prior_epoch" && inspection.workerEpoch === intent.workerEpoch)) {
      return fail("conflict", "Trusted worker inspection does not match this attempt.");
    }
    return inspection;
  }
  private async cancellationEvidence(project: ClipProject, intent: EditorExportIntent): Promise<EditorCancellationSettlement | null> {
    this.worker?.assertPreparationOnly();
    const evidence = await this.worker?.readCancellationSettlement?.(project, intent) ?? null;
    if (evidence && (!intent.workerEpoch || evidence.workerEpoch !== intent.workerEpoch
      || evidence.workerEpoch !== this.worker?.getWorkerEpoch?.() || evidence.requestId !== intent.requestId
      || evidence.attemptId !== intent.attemptId || evidence.cancelCommandId !== intent.cancellation?.commandId
      || evidence.settled !== true || typeof evidence.assertCurrent !== "function")) return fail("conflict", "Trusted cancellation settlement does not match the exact persisted fence.");
    return evidence;
  }
  private assetIdentities(assets: readonly StoredEditorOverlayAsset[]): EditorOverlayAssetIdentity[] {
    return assets.map(({ overlayId, src, sha256, format, byteLength, width, height }) => ({ overlayId, src, sha256, format, byteLength, width, height }));
  }
  private musicIdentity(asset: StoredEditorMusicAsset): EditorMusicAssetIdentity {
    const { slot, format, mimeType, demuxer, codec, bitsPerSample, sampleRate, channels, sampleFrames,
      durationSec, byteLength, sha256, sourceRefSha256 } = asset;
    const parsed = editorMusicAssetIdentitySchema.safeParse({ slot, format, mimeType, demuxer, codec,
      bitsPerSample, sampleRate, channels, sampleFrames, durationSec, byteLength, sha256, sourceRefSha256 });
    if (!parsed.success) return fail("unavailable", "The trusted stored music identity is invalid.");
    return Object.freeze(parsed.data);
  }
  private assertAssetsCurrent(assets: VerifiedEditorAssets, project: Readonly<ClipProject>): void {
    assets.overlays.forEach((asset) => asset.assertCurrentFile());
    if (Boolean(project.audio.musicSrc) !== Boolean(assets.music)) return fail("conflict", "The stored music attachment changed.");
    assets.music?.assertCurrentProject(project);
  }
  private async resolveMusic(target: EditorTarget, project: Readonly<ClipProject>): Promise<StoredEditorMusicAsset | null> {
    if (!project.audio.musicSrc) return null;
    if (!this.musicAssets) return fail("unavailable", "The existing music asset resolver is not configured.");
    const music = await this.musicAssets.resolve(target);
    if (!music) return fail("unavailable", "The existing music attachment could not be verified.");
    this.musicIdentity(music);
    if (!sameTarget(target, music.target)) return fail("conflict", "The stored music proof belongs to a different editor target.");
    music.assertCurrentProject(project);
    return music;
  }
  private async resolveAssets(target: EditorTarget): Promise<VerifiedEditorAssets> {
    const record = this.binding.records.find((row) => row.projectId === target.projectId);
    if (!record) return fail("forbidden", "The editor assets are outside the trusted project scope.");
    const projects = (await this.store.read())?.clipProjects.filter((row) => row.id === target.projectId) ?? [];
    if (projects.length !== 1) return fail("conflict", "The original editor project is missing or ambiguous.");
    const project = projects[0];
    if (!sameTarget(target, stateTarget(project, record, this.state(project, record)))) return fail("conflict", "The editor revision changed before its asset bytes were verified.");
    if (project.overlays.some((row) => row.kind === "text" ? Boolean(row.src) : !storedImageRef(row.src))) {
      return fail("unavailable", "This project requires an unsupported original asset capability.");
    }
    const ids = project.overlays.filter((row) => row.kind !== "text").map((row) => row.id);
    if (ids.length && !this.overlayAssets) return fail("unavailable", "The existing image asset resolver is not configured.");
    if (project.audio.musicSrc && !this.musicAssets) return fail("unavailable", "The existing music asset resolver is not configured.");
    const overlays = ids.length ? await this.overlayAssets!.resolveMany(target, ids) : [];
    const music = await this.resolveMusic(target, project);
    const assets = { overlays, music };
    this.assertAssetsCurrent(assets, project);
    return assets;
  }
  private async exportAssets(target: EditorTarget): Promise<VerifiedEditorAssets> {
    const assets = await this.resolveAssets(target);
    const project = (await this.store.read())?.clipProjects.find((row) => row.id === target.projectId);
    if (!project || project.sfx?.enabled) return fail("unavailable", "This export requires an unsupported original sound capability.");
    return assets;
  }
}
