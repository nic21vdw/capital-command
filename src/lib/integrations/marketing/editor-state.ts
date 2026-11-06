import { createHash } from "node:crypto";
import { renderSignature } from "@/lib/clipping/export-signature";
import type { AppData, ClipProject } from "@/types/domain";
import { editorCreationReceiptSchema, type EditorExportIntent, type MarketingEditorState } from "./editor-types";

export function canonicalEditorJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalEditorJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, field]) => `${JSON.stringify(key)}:${canonicalEditorJson(field)}`).join(",")}}`;
}
export const editorDigest = (value: unknown): string => createHash("sha256").update(canonicalEditorJson(value)).digest("hex");
export function editorProjectDigest(project: ClipProject): string {
  const { marketingEditor: _state, updatedAt: _updated, renderSignature: _signature,
    captionCount: _count, captionsOmitted: _omitted, ...content } = project;
  void [_state, _updated, _signature, _count, _omitted];
  return editorDigest(content);
}
export function editorRenderSignature(project: ClipProject): string {
  return renderSignature({ ...project, settings: project.exportSettings });
}
export class ManagedEditorWriteConflictError extends Error {
  constructor() { super("The editor project changed since this copy was loaded. Reload it before saving."); this.name = "ManagedEditorWriteConflictError"; }
}
export class ManagedEditorDeletedError extends Error {
  constructor() { super("This clip project was deleted. Its command receipts are retained, and it cannot be saved again."); this.name = "ManagedEditorDeletedError"; }
}
export class ManagedEditorCreationConflictError extends Error {
  constructor() { super("The original project creation records changed or are inconsistent."); this.name = "ManagedEditorCreationConflictError"; }
}
const same = (left: unknown, right: unknown) => canonicalEditorJson(left) === canonicalEditorJson(right);
const creationReceipts = (state: MarketingEditorState | undefined) => state?.receipts.filter((entry) => entry.result.operation === "create_editor_project_from_source") ?? [];
/** Existing writes cannot erase or promote creation authority/history. */
function preserveCreationMetadata(project: ClipProject, original: ClipProject): void {
  const next = project.marketingEditor;
  const previous = original.marketingEditor;
  if ((next?.creationRevision ?? 0) !== (previous?.creationRevision ?? 0)
    || !same(next?.creation, previous?.creation) || !same(creationReceipts(next), creationReceipts(previous))) throw new ManagedEditorCreationConflictError();
}
export type TrustedEditorProjectCreation = { rootProjectId: string; childProjectId: string };
/** Exactly one receipt append and one fresh child; root editing state is untouched. */
export function assertEditorProjectCreation(original: ClipProject, root: ClipProject, child: ClipProject): void {
  const { marketingEditor: _old, ...oldContent } = original;
  const { marketingEditor: _next, ...nextContent } = root;
  void [_old, _next];
  const previous = original.marketingEditor ? currentEditorState(original, original.marketingEditor) : undefined;
  const next = root.marketingEditor;
  const created = child.marketingEditor;
  const oldReceipts = previous?.receipts ?? [];
  const appended = next?.receipts.at(-1);
  const receipt = editorCreationReceiptSchema.safeParse(appended?.result);
  if (!same(oldContent, nextContent) || !next || !created || !receipt.success || !appended
    || original.id === child.id || next.deletedAt || created.deletedAt || previous?.creation
    || next.creationRevision !== (previous?.creationRevision ?? 0) + 1
    || creationReceipts(next).length !== next.creationRevision
    || next.receipts.length !== oldReceipts.length + 1 || !same(next.receipts.slice(0, -1), oldReceipts)
    || receipt.data.rootProjectId !== original.id || receipt.data.createdProjectId !== child.id
    || receipt.data.creationRevision !== next.creationRevision
    || receipt.data.revision !== next.revision || receipt.data.digest !== next.digest || receipt.data.renderSignature !== next.renderSignature
    || created.ownerId !== next.ownerId || created.jobId !== next.jobId || created.clipId !== next.clipId
    || child.jobId !== original.jobId || child.sourceFile !== original.sourceFile
    || created.revision !== 0 || created.receipts.length || created.exports.length || created.creationRevision !== undefined
    || created.digest !== editorProjectDigest(child) || created.renderSignature !== editorRenderSignature(child)) throw new ManagedEditorCreationConflictError();
  const baseline: MarketingEditorState = previous ?? { ownerId: next.ownerId, jobId: next.jobId, clipId: next.clipId,
    revision: 0, digest: editorProjectDigest(original), renderSignature: editorRenderSignature(original), receipts: [], exports: [] };
  if (!same({ ...next, creationRevision: undefined, receipts: [] }, { ...baseline, creationRevision: undefined, receipts: [] })
    || !same(created.creation, { rootProjectId: original.id, commandId: receipt.data.commandId, payloadSha256: appended.payloadSha256,
      policyId: receipt.data.policyId, policyVersion: receipt.data.policyVersion, creationRevision: receipt.data.creationRevision,
      sourceDigest: receipt.data.sourceDigest, captionDigest: receipt.data.captionDigest, sourceSha256: receipt.data.sourceSha256,
      captionState: receipt.data.captionState, grantDigest: receipt.data.grantDigest })) throw new ManagedEditorCreationConflictError();
}
/** Editing cannot turn an unconfirmed stop into permission to start new work. */
export function invalidateEditorExportIntent(intent: EditorExportIntent): EditorExportIntent {
  return { ...intent, state: ["cancel_requested", "canceled", "uncertain"].includes(intent.state) ? intent.state : "stale" };
}
/** Pure: reads may report legacy edits without writing a repair. */
export function currentEditorState(project: ClipProject, previous: MarketingEditorState): MarketingEditorState {
  const digest = editorProjectDigest(project);
  const signature = editorRenderSignature(project);
  if (digest === previous.digest && signature === previous.renderSignature) return structuredClone(previous);
  if (previous.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Editor revision exhausted.");
  return { ...structuredClone(previous), revision: previous.revision + 1, digest, renderSignature: signature,
    exports: previous.exports.map(invalidateEditorExportIntent) };
}

/**
 * Every original document writer passes here. Disk owns receipts and enrollment;
 * stale whole-document writes cannot forge/erase either. Deletions retain the
 * original row as a tombstone so a command UUID is never made reusable.
 * Only mutateExistingClipProject may commit an authenticated transition.
 */
export function preserveManagedEditorProjects(
  next: AppData, previous: AppData | null, trustedProjectId?: string, creation?: TrustedEditorProjectCreation
): AppData {
  const prior = new Map((previous?.clipProjects ?? []).map((project) => [project.id, project]));
  if (creation) {
    const root = next.clipProjects.filter((project) => project.id === creation.rootProjectId);
    const child = next.clipProjects.filter((project) => project.id === creation.childProjectId);
    const original = previous?.clipProjects.filter((project) => project.id === creation.rootProjectId) ?? [];
    if (trustedProjectId !== creation.rootProjectId || root.length !== 1 || child.length !== 1 || original.length !== 1
      || prior.has(creation.childProjectId)) throw new ManagedEditorCreationConflictError();
    assertEditorProjectCreation(original[0], root[0], child[0]);
    const { clipProjects: _nextRows, ...nextOther } = next;
    const { clipProjects: _priorRows, ...priorOther } = previous!;
    void [_nextRows, _priorRows];
    if (!same(nextOther, priorOther) || !same(next.clipProjects.filter((project) => project.id !== creation.rootProjectId && project.id !== creation.childProjectId),
      previous!.clipProjects.filter((project) => project.id !== creation.rootProjectId))) throw new ManagedEditorCreationConflictError();
    // Creation has exactly two whitelisted rows. Do not run ordinary writer
    // normalization on unrelated managed rows, even when their digest is stale.
    return next;
  }
  const projects: ClipProject[] = next.clipProjects.map((project) => {
    const original = prior.get(project.id);
    if (project.id === trustedProjectId) {
      if (original) preserveCreationMetadata(project, original);
      return project;
    }
    if (!original?.marketingEditor) {
      const { marketingEditor: _untrusted, ...original } = project;
      void _untrusted;
      return original;
    }
    if (original.marketingEditor.deletedAt) {
      if (project.marketingEditor?.deletedAt !== original.marketingEditor.deletedAt
        || editorProjectDigest(project) !== editorProjectDigest(original)) throw new ManagedEditorDeletedError();
      return original;
    }
    const state = currentEditorState(original, original.marketingEditor);
    if (editorProjectDigest(project) !== state.digest && (
      project.marketingEditor?.revision !== state.revision || project.marketingEditor?.digest !== state.digest
    )) throw new ManagedEditorWriteConflictError();
    return { ...project, marketingEditor: currentEditorState(project, state),
      renderSignature: editorRenderSignature(project), captionCount: project.captions.length };
  });
  const ids = new Set(projects.map((project) => project.id));
  for (const project of prior.values()) {
    if (!project.marketingEditor || ids.has(project.id)) continue;
    const state = structuredClone(project.marketingEditor);
    if (!state.deletedAt) {
      if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error("Editor revision exhausted.");
      state.revision += 1;
      state.deletedAt = new Date().toISOString();
      state.exports = state.exports.map((intent) => ({ ...intent, state: "stale" }));
    }
    projects.push({ ...project, marketingEditor: state });
  }
  return { ...next, clipProjects: projects };
}
