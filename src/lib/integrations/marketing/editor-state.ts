import { createHash } from "node:crypto";
import { renderSignature } from "@/lib/clipping/export-signature";
import type { AppData, ClipProject } from "@/types/domain";
import type { EditorExportIntent, MarketingEditorState } from "./editor-types";

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
  next: AppData, previous: AppData | null, trustedProjectId?: string
): AppData {
  const prior = new Map((previous?.clipProjects ?? []).map((project) => [project.id, project]));
  const projects: ClipProject[] = next.clipProjects.map((project) => {
    if (project.id === trustedProjectId) return project;
    const original = prior.get(project.id);
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
