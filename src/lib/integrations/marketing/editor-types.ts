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
  "save_editor_project", "request_editor_export", "claim_editor_export", "record_editor_export_outcome"
]);
export const editorExportStateSchema = z.enum([
  "pending_dispatch", "claimed", "prepared", "failed_before_dispatch", "uncertain", "stale"
]);
export const editorReceiptSchema = z.object({
  commandId: z.string().uuid(), operation: editorOperationSchema,
  revision, digest: sha256, renderSignature: z.string(),
  requestId: z.string().uuid().optional(), state: editorExportStateSchema.optional(),
  reviewInvalidated: z.literal(true), publicationAuthorized: z.literal(false)
}).strict();
export type EditorReceipt = z.infer<typeof editorReceiptSchema>;
export const editorExportIntentSchema = z.object({
  requestId: z.string().uuid(), revision, digest: sha256, renderSignature: z.string(),
  state: editorExportStateSchema, attemptId: z.string().uuid().optional(),
  // Internal proof only; media is independently resolved from the original job.
  artifactSha256: sha256.optional(), exportId: id.optional()
}).strict();
export type EditorExportIntent = z.infer<typeof editorExportIntentSchema>;
export const marketingEditorStateSchema = z.object({
  ownerId: z.string().min(1).max(128), jobId: id, clipId: id,
  revision, digest: sha256, renderSignature: z.string(),
  deletedAt: z.string().optional(),
  receipts: z.array(z.object({ payloadSha256: sha256, result: editorReceiptSchema }).strict()).max(1024),
  exports: z.array(editorExportIntentSchema).max(256)
}).strict();
export type MarketingEditorState = z.infer<typeof marketingEditorStateSchema>;
export type EditorRecordBinding = { projectId: string; jobId: string; clipId: string; sourceFile: string };
export type EditorBinding = { ownerId: string; records: readonly EditorRecordBinding[] };
export type EditorMediaDescriptor = { jobId: string; fileName: string };
export type EditorSnapshot = {
  project: ClipProject;
  target: EditorTarget;
  cachedCaptions: { captions: CaptionSegment[]; fetchedAt: string | null };
  media: {
    source: EditorMediaDescriptor; poster?: EditorMediaDescriptor;
    edited?: EditorMediaDescriptor & { renderSignature?: string; current: boolean };
  };
  export: { state: "not_requested" | EditorExportIntent["state"]; requestId?: string };
  capabilities: { save: boolean; requestExport: boolean; dispatchExport: false };
  reviewRequired: true;
  publicationAuthorized: false;
};
export type SaveEditorCommand = { operation: "save_editor_project"; commandId: string; target: EditorTarget; project: ClipProject };
export type RequestEditorExportCommand = { operation: "request_editor_export"; commandId: string; target: EditorTarget };
export type EditorCommandResult = { receipt: EditorReceipt; replayed: boolean; snapshot: EditorSnapshot };
