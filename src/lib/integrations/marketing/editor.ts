import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dataPath } from "@/lib/paths";
import { clipProjectSchema, captionSegmentSchema } from "@/lib/storage/schemas";
import { readExistingAppData, mutateExistingClipProject } from "@/lib/storage/store";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { AppData, ClipProject } from "@/types/domain";
import type { Principal } from "./safety";
import { canonicalEditorJson, currentEditorState, editorDigest, editorProjectDigest, editorRenderSignature } from "./editor-state";
import { editorTargetSchema, type EditorBinding, type EditorCommandResult, type EditorExportIntent,
  type EditorRecordBinding, type EditorReceipt, type EditorSnapshot, type EditorTarget,
  type MarketingEditorState, type RequestEditorExportCommand, type SaveEditorCommand } from "./editor-types";
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
export const requestEditorExportCommandSchema = z.object({ operation: z.literal("request_editor_export"), ...commandFields }).strict();
export const claimEditorExportCommandSchema = z.object({
  operation: z.literal("claim_editor_export"), ...commandFields, requestId: z.string().uuid()
}).strict();
export const recordEditorExportOutcomeSchema = z.object({
  operation: z.literal("record_editor_export_outcome"), ...commandFields,
  requestId: z.string().uuid(), attemptId: z.string().uuid(),
  outcome: z.enum(["prepared", "failed_before_dispatch", "uncertain"])
}).strict();
export const editorCommandSchema = z.discriminatedUnion("operation", [saveEditorCommandSchema, requestEditorExportCommandSchema]);
export type ClaimEditorExportCommand = z.infer<typeof claimEditorExportCommandSchema>;
export type RecordEditorExportOutcomeCommand = z.infer<typeof recordEditorExportOutcomeSchema>;
export type AnyEditorCommand = SaveEditorCommand | RequestEditorExportCommand | ClaimEditorExportCommand | RecordEditorExportOutcomeCommand;
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
  /** Recheck the trusted artifact identity immediately before locked commit. */
  assertCurrent(): void;
};
export type EditorWorkerPorts = {
  /** Trusted owner-process guard: renderer must have no enqueue/send side effect. */
  assertPreparationOnly(): void;
  readPreparation(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<EditorPreparationEvidence | null>;
  verifyFailureBeforeDispatch?(project: Readonly<ClipProject>, intent: Readonly<EditorExportIntent>): Promise<boolean>;
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
export const isEditorMediaFileName = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 255 && !value.startsWith(".") && !/[\\/:\u0000-\u001f\u007f]/.test(value);
const safeAsset = (value: string | undefined): string | undefined => value && (
  /^\/api\/clips\/overlay-images\/[a-f0-9]+\.(?:png|jpg|jpeg|webp|gif)$/.test(value)
  || /^data:(?:image\/(?:png|jpeg|webp|gif)|audio\/[A-Za-z0-9.+-]+);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)
) ? value : undefined;
function publicProject(project: ClipProject): ClipProject {
  const { marketingEditor: _private, ...original } = structuredClone(project);
  void _private;
  return { ...original, sourceUrl: "", posterFile: isEditorMediaFileName(original.posterFile) ? original.posterFile : undefined,
    audio: { ...original.audio, musicSrc: safeAsset(original.audio.musicSrc),
      musicName: original.audio.musicName && !/[\\/:]/.test(original.audio.musicName) ? original.audio.musicName : undefined },
    exportSettings: { ...original.exportSettings,
      filename: isEditorMediaFileName(original.exportSettings.filename) ? original.exportSettings.filename : "clip" },
    overlays: original.overlays.map((overlay) => ({ ...overlay, src: safeAsset(overlay.src) })),
    renderSignature: editorRenderSignature(project), captionCount: project.captions.length };
}
const equal = (a: unknown, b: unknown): boolean => canonicalEditorJson(a) === canonicalEditorJson(b);
const sameTarget = (a: EditorTarget, b: EditorTarget): boolean => equal(a, b);
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
    if (overlay.src !== safeAsset(prior?.src)) fail("invalid", "Image assets require the original asset selector.");
    if (!prior && overlay.kind !== "text") fail("invalid", "New image assets require the original asset selector.");
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
  constructor(options: { binding: EditorBinding; store?: EditorStore; worker?: EditorWorkerPorts }) {
    this.binding = structuredClone(options.binding);
    this.store = options.store ?? originalStore;
    this.worker = options.worker;
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
  private snapshot(project: ClipProject, record: EditorRecordBinding, job: ClipJob, clip: ClipCandidate, principal: Principal): EditorSnapshot {
    if (Math.abs(project.clipStart - clip.start) > 0.001 || Math.abs(project.clipEnd - clip.end) > 0.001) {
      return fail("conflict", "The original clip boundaries no longer match this editor project.");
    }
    const state = this.state(project, record);
    const current = Boolean(clip.editedFile && clip.editedSignature === state.renderSignature);
    const captions = z.array(captionSegmentSchema).safeParse(job.sourceCaptions ?? []);
    const latest = state.exports.at(-1);
    return {
      project: publicProject(project), target: stateTarget(project, record, state),
      cachedCaptions: { captions: captions.success ? captions.data : [],
        fetchedAt: typeof job.captionsFetchedAt === "string" && Number.isFinite(Date.parse(job.captionsFetchedAt)) ? job.captionsFetchedAt : null },
      media: { source: { jobId: record.jobId, fileName: record.sourceFile },
        ...(isEditorMediaFileName(project.posterFile) ? { poster: { jobId: record.jobId, fileName: project.posterFile } } : {}),
        ...(isEditorMediaFileName(clip.editedFile) ? { edited: { jobId: record.jobId, fileName: clip.editedFile,
          renderSignature: typeof clip.editedSignature === "string" && /^[a-z0-9]{1,64}$/.test(clip.editedSignature) ? clip.editedSignature : undefined, current } } : {}) },
      export: latest ? { state: latest.state, requestId: latest.requestId } : { state: "not_requested" },
      capabilities: { save: principal.scopes.includes("write"), requestExport: principal.scopes.includes("write"), dispatchExport: false },
      reviewRequired: true, publicationAuthorized: false
    };
  }
  async list(principal: Principal): Promise<{ id: string; name: string; updatedAt: string; jobId: string; durationSec: number }[]> {
    if (principal.ownerId !== this.binding.ownerId || !principal.scopes.includes("read")) fail("forbidden", "This editor operation is outside the verified owner scope.");
    if (!this.binding.records.length) return [];
    const data = await this.store.read();
    return (data?.clipProjects ?? []).flatMap((project) => {
      const record = this.binding.records.find((row) => row.projectId === project.id);
      if (!record || project.marketingEditor?.deletedAt) return [];
      this.state(project, record);
      return [{ id: project.id, name: project.name, updatedAt: project.updatedAt, jobId: project.jobId, durationSec: project.baseDurationSec }];
    });
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
      : input?.operation === "request_editor_export" ? requestEditorExportCommandSchema
      : input?.operation === "claim_editor_export" ? claimEditorExportCommandSchema
      : input?.operation === "record_editor_export_outcome" ? recordEditorExportOutcomeSchema : null;
    if (!schema) return fail("invalid", "The editor command is invalid or incomplete.");
    const command = this.parsed(schema as z.ZodType<AnyEditorCommand>, input);
    const scope = command.operation === "claim_editor_export" || command.operation === "record_editor_export_outcome" ? "worker" : "write";
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
    if (state.deletedAt) return { receipt: prior.result, replayed: true, snapshot: null, reconciliation: { state: "deleted" } };
    try {
      const { job, clip } = await this.original(record);
      return { receipt: prior.result, replayed: true, snapshot: this.snapshot(project, record, job, clip, principal) };
    } catch {
      return { receipt: prior.result, replayed: true, snapshot: null, reconciliation: { state: "record_unavailable" } };
    }
  }
  private async transact(
    principal: Principal, command: AnyCommand, transition: (project: ClipProject, state: MarketingEditorState) => { project: ClipProject; state: MarketingEditorState; intent?: EditorExportIntent },
    scope: "write" | "worker" = "write"
  ): Promise<EditorCommandResult> {
    const committed = await this.replay(principal, command);
    if (committed) return committed;
    const record = this.authorize(principal, command.target.projectId, scope);
    const { job, clip } = await this.original(record);
    const payloadSha256 = editorDigest(command);
    let receipt!: EditorReceipt;
    let replayed = false;
    const saved = await this.store.mutate(record.projectId, (project) => {
      const state = this.state(project, record);
      if (Math.abs(project.clipStart - clip.start) > 0.001 || Math.abs(project.clipEnd - clip.end) > 0.001) {
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
          ...(next.intent.attemptId ? { attemptId: next.intent.attemptId } : {}) } : {}),
        reviewInvalidated: true, publicationAuthorized: false };
      next.state.receipts.push({ payloadSha256, result: receipt });
      return { ...next.project, marketingEditor: next.state, renderSignature: next.state.renderSignature, captionCount: next.project.captions.length };
    });
    // The response uses the same original source cache read before mutation;
    // publication readiness still requires independent current-byte proof.
    return { receipt, replayed, snapshot: this.snapshot(saved, record, job, clip, principal) };
  }
  async save(principal: Principal, input: SaveEditorCommand): Promise<EditorCommandResult> {
    const command = this.parsed(saveEditorCommandSchema, input) as SaveEditorCommand;
    return this.transact(principal, command, (project, state) => {
      const edited = validateEdit(command.project, project);
      const next = currentEditorState(edited, state);
      // Even a no-op save is an explicit new review boundary. Requesting an
      // export alone does not change the project revision.
      if (next.revision === state.revision) {
        if (next.revision >= Number.MAX_SAFE_INTEGER) return fail("unavailable", "The editor revision requires reconciliation.");
        next.revision += 1;
        next.exports = next.exports.map((intent) => ({ ...intent, state: "stale" }));
      }
      return { project: edited, state: next };
    });
  }
  async requestExport(principal: Principal, input: RequestEditorExportCommand): Promise<EditorCommandResult> {
    const command = this.parsed(requestEditorExportCommandSchema, input);
    return this.transact(principal, command, (project, state) => {
      if (state.exports.some((intent) => ["pending_dispatch", "claimed", "uncertain"].includes(intent.state))) fail("conflict", "An export is pending, claimed, or uncertain and must be reconciled before another request.");
      if (state.exports.length >= 256) fail("unavailable", "The editor export history is full and requires reconciliation.");
      const intent: EditorExportIntent = { requestId: command.commandId, revision: state.revision,
        digest: state.digest, renderSignature: state.renderSignature, state: "pending_dispatch" };
      state.exports.push(intent);
      return { project, state, intent };
    });
  }
  async claimExport(principal: Principal, input: ClaimEditorExportCommand): Promise<EditorCommandResult & { attemptId: string }> {
    const command = this.parsed(claimEditorExportCommandSchema, input);
    this.authorize(principal, command.target.projectId, "worker");
    const replay = await this.replay(principal, command);
    if (!replay && !this.worker) return fail("unavailable", "No preparation-only renderer is bound. The explicit export intent remains pending.");
    if (!replay) this.worker!.assertPreparationOnly();
    const result = replay ?? await this.transact(principal, command, (project, state) => {
      const intent = state.exports.find((candidate) => candidate.requestId === command.requestId);
      if (!intent || intent.state !== "pending_dispatch" || intent.digest !== state.digest || intent.revision !== state.revision) return fail("conflict", "The export request is not pending for this exact editor revision.");
      intent.state = "claimed"; intent.attemptId = randomUUID();
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
    const project = (await this.store.read())?.clipProjects.find((candidate) => candidate.id === command.target.projectId);
    const intent = project?.marketingEditor?.exports.find((candidate) => candidate.requestId === command.requestId);
    if (!project || !intent || intent.attemptId !== command.attemptId) return fail("conflict", "The original export attempt does not match.");
    const evidence = command.outcome === "prepared" ? await this.worker.readPreparation(project, intent) : null;
    const failureVerified = command.outcome === "failed_before_dispatch"
      ? await this.worker.verifyFailureBeforeDispatch?.(project, intent) : false;
    if (command.outcome === "prepared" && (!evidence || evidence.requestId !== intent.requestId || evidence.attemptId !== intent.attemptId
      || evidence.digest !== intent.digest || evidence.renderSignature !== intent.renderSignature
      || !safeId(evidence.exportId) || !/^[a-f0-9]{64}$/.test(evidence.artifactSha256))) fail("conflict", "Independent preparation proof does not match this export attempt.");
    if (command.outcome === "failed_before_dispatch" && !failureVerified) fail("conflict", "The worker has not independently verified failure before dispatch.");
    return this.transact(principal, command, (current, state) => {
      const active = state.exports.find((candidate) => candidate.requestId === command.requestId);
      if (!active || active.state !== "claimed" || active.attemptId !== command.attemptId || active.digest !== state.digest
        || active.revision !== state.revision) return fail("conflict", "The export attempt is stale or no longer claimed.");
      evidence?.assertCurrent();
      active.state = command.outcome;
      if (evidence) { active.artifactSha256 = evidence.artifactSha256; active.exportId = evidence.exportId; }
      return { project: current, state, intent: active };
    }, "worker");
  }
}
