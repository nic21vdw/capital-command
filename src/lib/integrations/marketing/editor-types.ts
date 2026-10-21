import { z } from "zod";
import type { CaptionSegment, ClipProject } from "@/types/domain";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const editorTargetSchema = z.object({
  projectId: id, jobId: id, clipId: id, revision, digest: sha256,
  renderSignature: z.string().min(1).max(64)
}).strict();
export type EditorTarget = z.infer<typeof editorTargetSchema>;
export const editorOperationSchema = z.enum([
  "save_editor_project", "delete_editor_project", "request_editor_export", "claim_editor_export", "record_editor_export_outcome",
  "cancel_editor_export", "reconcile_editor_export", "settle_editor_export_cancellation"
]);
export const editorExportStateSchema = z.enum([
  "pending_dispatch", "claimed", "prepared", "failed_before_dispatch", "uncertain", "stale", "cancel_requested", "canceled"
]);
export const editorReceiptSchema = z.object({
  commandId: z.string().uuid(), operation: editorOperationSchema,
  revision, digest: sha256, renderSignature: z.string(),
  requestId: z.string().uuid().optional(), state: editorExportStateSchema.optional(),
  attemptId: z.string().uuid().optional(),
  cancelCommandId: z.string().uuid().optional(),
  reviewInvalidated: z.literal(true), publicationAuthorized: z.literal(false)
}).strict();
export type EditorReceipt = z.infer<typeof editorReceiptSchema>;
const creationFields = { policyId: id, policyVersion: id, creationRevision: revision,
  sourceDigest: sha256, captionDigest: sha256, captionState: z.enum(["absent", "present"]), sourceSha256: sha256, grantDigest: sha256 };
/** Creation does not invalidate the root's edits, approval or prepared output. */
export const editorCreationReceiptSchema = z.object({
  operation: z.literal("create_editor_project_from_source"), commandId: z.string().uuid(),
  rootProjectId: id, createdProjectId: id, revision, digest: sha256, renderSignature: z.string(), ...creationFields,
  reviewInvalidated: z.literal(false), rootReviewPreserved: z.literal(true), publicationAuthorized: z.literal(false),
  requestId: z.never().optional(), state: z.never().optional(), attemptId: z.never().optional(), cancelCommandId: z.never().optional()
}).strict();
export type EditorCreationReceipt = z.infer<typeof editorCreationReceiptSchema>;
export const editorProjectCreationProvenanceSchema = z.object({
  rootProjectId: id, commandId: z.string().uuid(), payloadSha256: sha256, ...creationFields
}).strict();
export type EditorProjectCreationProvenance = z.infer<typeof editorProjectCreationProvenanceSchema>;
export const editorOverlayAssetIdentitySchema = z.object({
  overlayId: z.string().min(1).max(128), src: z.string().max(128),
  sha256, format: z.enum(["png", "jpeg", "webp"]), byteLength: z.number().int().positive().max(8 * 1024 * 1024),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192)
}).strict();
export type EditorOverlayAssetIdentity = z.infer<typeof editorOverlayAssetIdentitySchema>;
/** Exact supported stored PCM bytes; never a selector or ownership grant. */
export const editorMusicAssetIdentitySchema = z.object({
  slot: z.literal("background_music"), format: z.literal("wav"), mimeType: z.literal("audio/wav"),
  demuxer: z.literal("wav"), codec: z.literal("pcm_s16le"), bitsPerSample: z.literal(16),
  sampleRate: z.number().int().min(8000).max(48000), channels: z.union([z.literal(1), z.literal(2)]),
  sampleFrames: z.number().int().positive().max(600 * 48000), durationSec: z.number().positive().max(600),
  byteLength: z.number().int().positive().max(8 * 1024 * 1024), sha256, sourceRefSha256: sha256
}).strict().refine((asset) => asset.byteLength === 44 + asset.sampleFrames * asset.channels * 2
  && asset.durationSec === asset.sampleFrames / asset.sampleRate, "The stored music identity is inconsistent.");
export type EditorMusicAssetIdentity = z.infer<typeof editorMusicAssetIdentitySchema>;
export const editorExportIntentSchema = z.object({
  requestId: z.string().uuid(), revision, digest: sha256, renderSignature: z.string(),
  state: editorExportStateSchema, attemptId: z.string().uuid().optional(),
  /** Trusted owning-process identity; never supplied by public commands. */
  workerEpoch: z.string().uuid().optional(),
  cancellation: z.object({ commandId: z.string().uuid(), requestedAt: z.string().datetime() }).strict().optional(),
  reconciliation: z.object({ commandId: z.string().uuid(), reconciledAt: z.string().datetime(),
    reason: z.literal("unconfirmed_attempt") }).strict().optional(),
  supersedesRequestId: z.string().uuid().optional(),
  supersededByRequestId: z.string().uuid().optional(),
  // Internal proof only; media is independently resolved from the original job.
  artifactSha256: sha256.optional(), exportId: id.optional(),
  /** Exact existing image bytes approved by this explicit export request. */
  overlayAssets: z.array(editorOverlayAssetIdentitySchema).max(32).optional(),
  /** Exact existing music bytes approved alongside the original project revision. */
  musicAsset: editorMusicAssetIdentitySchema.optional()
}).strict();
export type EditorExportIntent = z.infer<typeof editorExportIntentSchema>;
export const marketingEditorStateSchema = z.object({
  ownerId: z.string().min(1).max(128), jobId: id, clipId: id,
  revision, digest: sha256, renderSignature: z.string(),
  deletedAt: z.string().optional(),
  creationRevision: revision.optional(),
  creation: editorProjectCreationProvenanceSchema.optional(),
  receipts: z.array(z.object({ payloadSha256: sha256, result: z.union([editorReceiptSchema, editorCreationReceiptSchema]) }).strict()).max(1024),
  exports: z.array(editorExportIntentSchema).max(256)
}).strict();
export type MarketingEditorState = z.infer<typeof marketingEditorStateSchema>;
export type EditorRecordBinding = { projectId: string; jobId: string; clipId: string; sourceFile: string };
export type EditorBinding = { ownerId: string; records: readonly EditorRecordBinding[] };
/** Trusted code-only capability. No runtime policy is installed by these types. */
export const editorCreationPolicySchema = z.object({
  id, version: id, ownerId: z.string().min(1).max(128),
  roots: z.array(z.object({ projectId: id, jobId: id, clipId: id,
    sourceFile: z.string().min(1).max(255).refine((value) => !value.startsWith(".") && !/[\\/:\u0000-\u001f\u007f]/.test(value)),
    sourceSha256: sha256, maxCreatedProjects: z.number().int().min(1).max(32)
  }).strict()).min(1).max(32)
}).strict();
export type EditorCreationPolicy = z.infer<typeof editorCreationPolicySchema>;
export type EditorCreationPolicyReader = () => EditorCreationPolicy | null;
export const editorCreationContextSchema = z.object({
  target: editorTargetSchema, policyId: id, policyVersion: id, creationRevision: revision,
  sourceDigest: sha256, captionDigest: sha256, captionState: z.enum(["absent", "present"])
}).strict();
export type EditorCreationContext = z.infer<typeof editorCreationContextSchema>;
export const createEditorProjectFromSourceCommandSchema = editorCreationContextSchema.extend({
  operation: z.literal("create_editor_project_from_source"), commandId: z.string().uuid()
}).strict();
export type CreateEditorProjectFromSourceCommand = z.infer<typeof createEditorProjectFromSourceCommandSchema>;
export type EditorMediaDescriptor = { jobId: string; fileName: string };
export type EditorProjectSummary = {
  id: string; name: string; updatedAt: string; jobId: string; durationSec: number;
  /** Issued from the scoped stored project without requiring a live source. */
  deleteTarget: EditorTarget;
  canDelete: boolean;
};
export type EditorSnapshot = {
  project: ClipProject;
  /** Server preflight flag; never contains original asset URLs or local paths. */
  requiresAssetConnection: boolean;
  target: EditorTarget;
  cachedCaptions: { captions: CaptionSegment[]; fetchedAt: string | null };
  media: {
    source: EditorMediaDescriptor; poster?: EditorMediaDescriptor;
    edited?: EditorMediaDescriptor & { renderSignature?: string; current: boolean };
    /** Private projection resolves these IDs to opaque protected image references. */
    overlays?: { overlayId: string }[];
    /** Private projection only; neither original inline bytes nor a caller URL. */
    music?: EditorMusicAssetIdentity;
  };
  export: { state: "not_requested" | EditorExportIntent["state"]; requestId?: string; attemptId?: string };
  capabilities: { save: boolean; deleteProject: boolean; requestExport: boolean; dispatchExport: false };
  reviewRequired: true;
  publicationAuthorized: false;
};
export type SaveEditorCommand = { operation: "save_editor_project"; commandId: string; target: EditorTarget; project: ClipProject };
export type RequestEditorExportCommand = { operation: "request_editor_export"; commandId: string; target: EditorTarget; supersedesRequestId?: string };
export type DeleteEditorCommand = { operation: "delete_editor_project"; commandId: string; target: EditorTarget };
export type CancelEditorExportCommand = { operation: "cancel_editor_export"; commandId: string; target: EditorTarget; requestId: string; attemptId?: string };
export type ReconcileEditorExportCommand = { operation: "reconcile_editor_export"; commandId: string; target: EditorTarget; requestId: string; attemptId?: string };
export type SettleEditorExportCancellationCommand = { operation: "settle_editor_export_cancellation"; commandId: string;
  target: EditorTarget; requestId: string; attemptId: string; cancelCommandId: string };
export type EditorCommandResult = { receipt: EditorReceipt; replayed: boolean; snapshot: EditorSnapshot | null;
  reconciliation?: { state: "deleted" | "record_unavailable" | "refresh_required" } };
export type EditorProjectCreationResult = { receipt: EditorCreationReceipt; replayed: boolean; createdProjectId: string;
  childTarget: EditorTarget | null; snapshot: EditorSnapshot | null;
  reconciliation?: { state: "policy_unavailable" | "record_unavailable" | "deleted" } };
